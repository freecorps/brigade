// PushKit → CallKit → audio session → speech (spike S6, RFC 0010). Everything runs on the main queue; the Expo
// module (whose sync functions run on the JS thread) hops there, and reads only `answeredCall`, a locked snapshot.
//
// Apple's rule: every VoIP push must end in `reportNewIncomingCall` before its completion handler returns, or iOS
// terminates the app and, after repeated violations, stops delivering VoIP pushes. So the push handler reports
// the call first, with the localized fallback name, and only then decrypts and updates the caller name. Nothing
// in the payload can make it skip the report (the relay only sends calls for pages; apps/relay/src/apns.ts).
import AVFoundation
import BrigadePush
import CallKit
import Foundation
import PushKit
import UserNotifications
import os

struct IncomingCall {
  let id: UUID
  var title: String
  var body: String
  var incident: String?
  var answered = false
  /// When CallKit confirmed the call (it started ringing); nil until then.
  var ringingSince: Date?
  /// 1 was pressed on CallKit's keypad, maybe before JavaScript was listening (a cold launch from a VoIP push).
  /// It stays set for the rest of the call: JavaScript that reads it again acknowledges again, which is harmless
  /// (a second `incident.ack` is a `conflict`, and the call session treats that as acknowledged).
  var ackKeyPressed = false

  var dictionary: [String: Any?] {
    [
      "id": id.uuidString.lowercased(), "title": title, "body": body, "incident": incident,
      "ackKeyPressed": ackKeyPressed,
    ]
  }
}

/// What the app knows about a VoIP push's call id. Mirrors `KnownCall`, `knownCall` and `voipPushPlan` in
/// apps/mobile/src/lib/call-route.ts, the tested source of truth: every case reports to CallKit.
enum KnownCall {
  case new, active, ended
}

/// How and when a call ended (`event` is the `onEnd` reason), kept in RAM only for `CallCenter.endedMemory`.
struct EndedCall {
  let reason: String
  let at: Date
}

final class CallCenter: NSObject, PKPushRegistryDelegate, CXProviderDelegate, AVSpeechSynthesizerDelegate,
  @unchecked Sendable
{
  static let shared = CallCenter()
  /// An unanswered call stops ringing after this; the instance escalates on its own timeout.
  static var ringTimeout: TimeInterval {
    #if DEBUG
      // Development: `-BrigadeTestCallRingTimeout <seconds>`, because the Simulator ends a ringing call itself
      // within a second of CallKit accepting it.
      let defaults = UserDefaults.standard
      if defaults.object(forKey: "BrigadeTestCallRingTimeout") != nil {
        return defaults.double(forKey: "BrigadeTestCallRingTimeout")
      }
    #endif
    return 60
  }
  /// An answered call hangs up this long after answering, ack or not. Mirrors `ANSWERED_CALL_MAX_MS` in
  /// apps/mobile/src/lib/call-route.ts.
  static let answeredMaxLength: TimeInterval = 180
  /// How long an ended call's id is remembered, so a late repeat of its page does not ring again: a push expires
  /// at most 5 minutes after it was sent (apps/relay/src/index.ts). Mirrors `ENDED_CALL_MEMORY_MS`.
  static let endedMemory: TimeInterval = 300
  /// Declined or answered: a repeat does not ring again; after `missed` or `failed` it does. Mirrors
  /// `REPEAT_SUPPRESSING_END_REASONS` in apps/mobile/src/lib/call-route.ts.
  static let repeatSuppressingReasons: Set<String> = ["declined", "hung_up", "timed_out"]
  /// An unanswered call ended sooner than this after it rang was ended by the system, not a person: `failed`, so a
  /// repeat rings. Mirrors `SYSTEM_END_MS` and `unansweredEndReason` (src/lib/call-route.ts).
  static let systemEnd: TimeInterval = 2

  /// Mirrors `knownCall` in apps/mobile/src/lib/call-route.ts.
  static func known(active: Bool, ended: EndedCall?, now: Date) -> KnownCall {
    if active { return .active }
    if let ended, now.timeIntervalSince(ended.at) < endedMemory, repeatSuppressingReasons.contains(ended.reason) {
      return .ended
    }
    return .new
  }

  private let log = Logger(subsystem: "app.freecorps.brigade", category: "call")
  private var registry: PKPushRegistry?
  private lazy var provider: CXProvider = {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = false
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    configuration.includesCallsInRecents = false
    let provider = CXProvider(configuration: configuration)
    provider.setDelegate(self, queue: nil)
    return provider
  }()
  private let controller = CXCallController()
  private let synthesizer = AVSpeechSynthesizer()
  private var calls: [UUID: IncomingCall] = [:] {
    didSet {
      let answered = calls.values.first { $0.answered }
      answeredSnapshot.withLock { $0 = answered }
    }
  }
  private var ended: [UUID: EndedCall] = [:]
  private let answeredSnapshot = OSAllocatedUnfairLock<IncomingCall?>(initialState: nil)
  private var pendingSpeech: (text: String, language: String)?
  private var audioActive = false

  private(set) var voipToken: String?
  /// Set by the Expo module: `onAnswer`, `onEnd`, `onAcknowledgeKey`, `onSpoken`.
  var emit: ((String, [String: Any?]) -> Void)?

  /// The answered call, from any thread: a copy of the value the main queue last stored.
  var answeredCall: IncomingCall? { answeredSnapshot.withLock { $0 } }

  /// From `didFinishLaunching`, so a VoIP push that launches the app in the background finds its delegate.
  func start() {
    guard registry == nil else { return }
    synthesizer.delegate = self
    synthesizer.usesApplicationAudioSession = true
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    self.registry = registry
    _ = provider
  }

  // MARK: - PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    voipToken = credentials.token.map { String(format: "%02x", $0) }.joined()
    log.info("voip token updated")
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    voipToken = nil
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let payload = payload.dictionaryPayload
    // A missing or malformed id still rings, under a new one: never return without reporting.
    let id = ((payload["call"] as? [String: Any])?["id"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()
    receive(id, envelope: payload["brigade"], completion: completion)
  }

  /// A VoIP push's call (or, in development, a simulated repeat of one).
  private func receive(_ id: UUID, envelope: Any?, completion: @escaping () -> Void) {
    let call = IncomingCall(id: id, title: Self.fallbackTitle, body: Self.fallbackBody)
    // Repeats of one page share its id. Every branch reports to CallKit before anything else.
    switch known(id) {
    case .new: report(call, completion: completion)
    case .active: reportRepeat(call, completion: completion)
    case .ended: reportEnded(call, completion: completion)
    }
    do {
      let content = try BrigadePushCrypto.open(envelope: envelope)
      update(id, title: content.title, body: content.body, incident: content.incident)
      log.info("voip push decrypted")
    } catch {
      log.error("voip push not decrypted: \(String(describing: error), privacy: .public)")
    }
  }

  // MARK: - Calls

  private func known(_ id: UUID) -> KnownCall {
    let now = Date()
    ended = ended.filter { now.timeIntervalSince($0.value.at) < Self.endedMemory }
    return Self.known(active: calls[id] != nil, ended: ended[id], now: now)
  }

  private func rememberEnded(_ id: UUID, reason: String) {
    ended[id] = EndedCall(reason: reason, at: Date())
  }

  private func callUpdate(_ call: IncomingCall) -> CXCallUpdate {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: Self.appName)
    update.localizedCallerName = call.title
    update.hasVideo = false
    update.supportsDTMF = true
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    return update
  }

  /// A repeat while the call still rings or is answered: CallKit answers `callUUIDAlreadyExists`, which is
  /// success. The call this app tracks is left as it is.
  private func reportRepeat(_ call: IncomingCall, completion: @escaping () -> Void) {
    provider.reportNewIncomingCall(with: call.id, update: callUpdate(calls[call.id] ?? call)) { [weak self] error in
      DispatchQueue.main.async {
        defer { completion() }
        if let error, (error as? CXErrorCodeIncomingCallError)?.code != .callUUIDAlreadyExists {
          self?.log.error("repeat not reported: \(String(describing: error), privacy: .public)")
        } else {
          self?.log.info("repeat reported")
        }
      }
    }
  }

  /// A late repeat of a page whose call already ended: reported, as iOS requires, then ended at once.
  private func reportEnded(_ call: IncomingCall, completion: @escaping () -> Void) {
    provider.reportNewIncomingCall(with: call.id, update: callUpdate(call)) { [weak self] error in
      DispatchQueue.main.async {
        defer { completion() }
        guard error == nil else { return }
        self?.provider.reportCall(with: call.id, endedAt: nil, reason: .answeredElsewhere)
        self?.log.info("repeat of an ended call reported and ended")
      }
    }
  }

  /// Reports a new call to CallKit. If CallKit refuses (Do Not Disturb, blocked, a call already in progress, no
  /// CallKit in this region), posts the page as a time-sensitive notification instead: never nothing.
  func report(_ call: IncomingCall, completion: @escaping () -> Void = {}) {
    calls[call.id] = call
    provider.reportNewIncomingCall(with: call.id, update: callUpdate(call)) { [weak self] error in
      DispatchQueue.main.async {
        defer { completion() }
        guard let self else { return }
        if let error {
          if (error as? CXErrorCodeIncomingCallError)?.code == .callUUIDAlreadyExists { return }
          self.log.error("call not reported: \(String(describing: error), privacy: .public)")
          guard let tracked = self.calls.removeValue(forKey: call.id) else {
            // Ended here before CallKit answered (only a reset does that today, recorded as `failed`): page unless
            // that end suppresses a repeat.
            if let ended = self.ended[call.id], Self.repeatSuppressingReasons.contains(ended.reason) { return }
            self.notifyPage(call)
            return
          }
          self.notifyPage(tracked)
          return
        }
        self.calls[call.id]?.ringingSince = Date()
        self.log.info("call reported")
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.ringTimeout) { self.timeOut(call.id) }
      }
    }
  }

  private func update(_ id: UUID, title: String, body: String, incident: String?) {
    guard calls[id] != nil else { return }
    calls[id]?.title = title
    calls[id]?.body = body
    calls[id]?.incident = incident
    let update = CXCallUpdate()
    update.localizedCallerName = title
    provider.reportCall(with: id, updated: update)
  }

  private func timeOut(_ id: UUID) {
    guard let call = calls[id], !call.answered else { return }
    finish(id, reason: .unanswered, event: "missed")
  }

  /// Ends a call from this side: CallKit is told, and no `CXEndCallAction` follows.
  private func finish(_ id: UUID, reason: CXCallEndedReason, event: String) {
    calls[id] = nil
    rememberEnded(id, reason: event)
    stopSpeaking()
    provider.reportCall(with: id, endedAt: nil, reason: reason)
    log.info("call ended: \(event, privacy: .public)")
    emit?("onEnd", ["id": id.uuidString.lowercased(), "reason": event])
  }

  /// Development: rings `call` after `delay`, through the path a decrypted VoIP push takes. Not a push, so it may
  /// skip CallKit for an id already ringing (the only caller that may; the push handler always reports).
  func simulate(_ call: IncomingCall, after delay: TimeInterval) {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      if self.calls[call.id] == nil { self.report(call) }
    }
  }

  #if DEBUG
    /// Development: a repeat of the page with call `id`, through the same decision a VoIP push takes (no envelope).
    func simulateRepeat(_ id: UUID) {
      DispatchQueue.main.async { self.receive(id, envelope: nil) {} }
    }
  #endif

  /// What a tap on Answer does, as a CallKit transaction (the Simulator cannot be tapped; see the write-up).
  func requestAnswer(_ id: UUID) { request(CXAnswerCallAction(call: id)) }

  /// What pressing 1 on CallKit's keypad does.
  func requestKey(_ id: UUID, digits: String) {
    request(CXPlayDTMFCallAction(call: id, digits: digits, type: .singleTone))
  }

  func requestEnd(_ id: UUID) { request(CXEndCallAction(call: id)) }

  private func request(_ action: CXCallAction) {
    DispatchQueue.main.async { [weak self] in
      self?.controller.request(CXTransaction(action: action)) { error in
        if let error {
          self?.log.error("call action failed: \(String(describing: error), privacy: .public)")
        }
      }
    }
  }

  // MARK: - CXProviderDelegate

  func providerDidReset(_ provider: CXProvider) {
    // Nobody chose to end these: a repeat rings again.
    calls.keys.forEach { rememberEnded($0, reason: "failed") }
    calls.removeAll()
    stopSpeaking()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard calls[action.callUUID] != nil else { return action.fail() }
    configureAudioSession()
    calls[action.callUUID]?.answered = true
    log.info("call answered")
    if let call = calls[action.callUUID] { emit?("onAnswer", call.dictionary) }
    action.fulfill()
    let id = action.callUUID
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.answeredMaxLength) { [weak self] in
      guard let self, self.calls[id]?.answered == true else { return }
      self.finish(id, reason: .remoteEnded, event: "timed_out")
    }
    // The Simulator may never activate the call's audio session; speak anyway after a moment.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
      guard let self, !self.audioActive else { return }
      self.log.info("no audio session activation; speaking anyway")
      self.audioActive = true
      self.flushSpeech()
    }
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let call = calls.removeValue(forKey: action.callUUID) else {
      // Already ended here (timed out, or a repeat reported and ended): keep the reason it ended with.
      return action.fulfill()
    }
    let reason =
      call.answered
      ? "hung_up"
      : call.ringingSince.map { Date().timeIntervalSince($0) < Self.systemEnd } == true ? "failed" : "declined"
    rememberEnded(action.callUUID, reason: reason)
    stopSpeaking()
    log.info("call ended: \(reason, privacy: .public)")
    emit?("onEnd", ["id": action.callUUID.uuidString.lowercased(), "reason": reason])
    action.fulfill()
  }

  /// The keypad in CallKit's in-call UI, on the lock screen too: 1 acknowledges (RFC 0010).
  func provider(_ provider: CXProvider, perform action: CXPlayDTMFCallAction) {
    log.info("keypad pressed")
    if action.digits.contains("1") {
      // Kept on the call too: if JavaScript is not listening yet, the hook reads it from `getAnsweredCall()`.
      calls[action.callUUID]?.ackKeyPressed = true
      emit?("onAcknowledgeKey", ["id": action.callUUID.uuidString.lowercased()])
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    log.info("audio session activated")
    audioActive = true
    flushSpeech()
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    audioActive = false
  }

  private func configureAudioSession() {
    do {
      try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat)
    } catch {
      log.error("audio session: \(String(describing: error), privacy: .public)")
    }
  }

  // MARK: - Speech

  /// Speaks once the call's audio session is active (CallKit activates it after answering).
  func speak(_ text: String, language: String) {
    pendingSpeech = (text, language)
    if audioActive || calls.isEmpty { flushSpeech() }
  }

  func stopSpeaking() {
    pendingSpeech = nil
    synthesizer.stopSpeaking(at: .immediate)
  }

  private func flushSpeech() {
    guard let (text, language) = pendingSpeech else { return }
    pendingSpeech = nil
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = AVSpeechSynthesisVoice(language: language)
    log.info("speaking")
    synthesizer.speak(utterance)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    log.info("spoken")
    emit?("onSpoken", [:])
  }

  // MARK: - Fallback

  private func notifyPage(_ call: IncomingCall) {
    let content = UNMutableNotificationContent()
    content.title = call.title
    content.body = call.body
    content.sound = .default
    content.interruptionLevel = .timeSensitive
    let request = UNNotificationRequest(identifier: call.id.uuidString, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request) { [weak self] error in
      if let error { self?.log.error("page notification failed: \(String(describing: error), privacy: .public)") }
    }
    log.info("page notification instead of a call")
  }

  // From Localizable.strings, generated from packages/i18n (plugins/notification-service.ts).
  static var fallbackTitle: String { NSLocalizedString("push_fallback_title", comment: "") }
  static var fallbackBody: String { NSLocalizedString("push_fallback_body", comment: "") }
  static var appName: String { NSLocalizedString("call_caller", comment: "") }
}
