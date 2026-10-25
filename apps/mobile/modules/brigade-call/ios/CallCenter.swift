// PushKit → CallKit → audio session → speech (spike S6, RFC 0010). Everything runs on the main queue.
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

  var dictionary: [String: Any?] {
    ["id": id.uuidString.lowercased(), "title": title, "body": body, "incident": incident]
  }
}

final class CallCenter: NSObject, PKPushRegistryDelegate, CXProviderDelegate, AVSpeechSynthesizerDelegate,
  @unchecked Sendable
{
  static let shared = CallCenter()
  /// An unanswered call stops ringing after this; the instance escalates on its own timeout.
  static let ringTimeout: TimeInterval = 60

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
  private var calls: [UUID: IncomingCall] = [:]
  private var pendingSpeech: (text: String, language: String)?
  private var audioActive = false

  private(set) var voipToken: String?
  /// Set by the Expo module: `onAnswer`, `onEnd`, `onAcknowledgeKey`, `onSpoken`.
  var emit: ((String, [String: Any?]) -> Void)?

  var answeredCall: IncomingCall? { calls.values.first { $0.answered } }

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
    report(IncomingCall(id: id, title: Self.fallbackTitle, body: Self.fallbackBody), completion: completion)
    do {
      let content = try BrigadePushCrypto.open(envelope: payload["brigade"])
      update(id, title: content.title, body: content.body, incident: content.incident)
      log.info("voip push decrypted")
    } catch {
      log.error("voip push not decrypted: \(String(describing: error), privacy: .public)")
    }
  }

  // MARK: - Calls

  /// Reports a call to CallKit. If CallKit refuses (Do Not Disturb, blocked, a call already in progress, no
  /// CallKit in this region), posts the page as a time-sensitive notification instead: never nothing.
  func report(_ call: IncomingCall, completion: @escaping () -> Void = {}) {
    if calls[call.id] != nil { return completion() }
    calls[call.id] = call
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: Self.appName)
    update.localizedCallerName = call.title
    update.hasVideo = false
    update.supportsDTMF = true
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    provider.reportNewIncomingCall(with: call.id, update: update) { [weak self] error in
      DispatchQueue.main.async {
        defer { completion() }
        guard let self else { return }
        if let error {
          if (error as? CXErrorCodeIncomingCallError)?.code == .callUUIDAlreadyExists { return }
          self.log.error("call not reported: \(String(describing: error), privacy: .public)")
          let call = self.calls.removeValue(forKey: call.id) ?? call
          self.notifyPage(call)
          return
        }
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
    calls[id] = nil
    provider.reportCall(with: id, endedAt: nil, reason: .unanswered)
    emit?("onEnd", ["id": id.uuidString.lowercased(), "reason": "missed"])
  }

  /// Development: rings `call` after `delay`, through the same path a decrypted VoIP push takes.
  func simulate(_ call: IncomingCall, after delay: TimeInterval) {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.report(call) }
  }

  /// What a tap on Answer does, as a CallKit transaction (the Simulator cannot be tapped; see the write-up).
  func requestAnswer(_ id: UUID) { request(CXAnswerCallAction(call: id)) }

  /// What pressing 1 on CallKit's keypad does.
  func requestKey(_ id: UUID, digits: String) {
    request(CXPlayDTMFCallAction(call: id, digits: digits, type: .singleTone))
  }

  func requestEnd(_ id: UUID) { request(CXEndCallAction(call: id)) }

  private func request(_ action: CXCallAction) {
    controller.request(CXTransaction(action: action)) { [weak self] error in
      if let error {
        self?.log.error("call action failed: \(String(describing: error), privacy: .public)")
      }
    }
  }

  // MARK: - CXProviderDelegate

  func providerDidReset(_ provider: CXProvider) {
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
    // The Simulator may never activate the call's audio session; speak anyway after a moment.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
      guard let self, !self.audioActive else { return }
      self.log.info("no audio session activation; speaking anyway")
      self.audioActive = true
      self.flushSpeech()
    }
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let call = calls.removeValue(forKey: action.callUUID)
    stopSpeaking()
    log.info("call ended")
    emit?(
      "onEnd",
      ["id": action.callUUID.uuidString.lowercased(), "reason": call?.answered == true ? "hung_up" : "declined"])
    action.fulfill()
  }

  /// The keypad in CallKit's in-call UI, on the lock screen too: 1 acknowledges (RFC 0010).
  func provider(_ provider: CXProvider, perform action: CXPlayDTMFCallAction) {
    log.info("keypad pressed")
    if action.digits.contains("1") {
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
