import ExpoModulesCore

/// Starts PushKit and CallKit at launch, so a VoIP push that launches the app in the background is handled.
public class BrigadeCallAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallCenter.shared.start()
    #if DEBUG
      ringTestCallFromLaunchArguments()
    #endif
    return false
  }

  #if DEBUG
    /// Development: `xcrun simctl launch booted app.freecorps.brigade -BrigadeTestCall "SEV1 · Checkout down"`
    /// rings a test call. `-BrigadeTestCallAnswer YES` then answers it, and `-BrigadeTestCallAck YES` presses 1,
    /// as CallKit transactions (the same path as tapping): this beta Simulator cannot be tapped.
    /// For the repeat rule: `-BrigadeTestCallId <uuid>` fixes the call id, `-BrigadeTestCallEndAs missed|declined`
    /// ends the call that way half a second after it rings, and `-BrigadeTestCallRepeatAfter <seconds>` then sends
    /// a repeat of the page through the VoIP push decision.
    private func ringTestCallFromLaunchArguments() {
      let defaults = UserDefaults.standard
      guard let title = defaults.string(forKey: "BrigadeTestCall") else { return }
      let delay = defaults.object(forKey: "BrigadeTestCallDelay") != nil ? defaults.double(forKey: "BrigadeTestCallDelay") : 8
      let call = IncomingCall(
        id: defaults.string(forKey: "BrigadeTestCallId").flatMap(UUID.init(uuidString:)) ?? UUID(),
        title: title,
        body: defaults.string(forKey: "BrigadeTestCallBody") ?? CallCenter.fallbackBody,
        incident: defaults.string(forKey: "BrigadeTestCallIncident"))
      let center = CallCenter.shared
      center.simulate(call, after: delay)
      if defaults.bool(forKey: "BrigadeTestCallAnswer") {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + 4) { center.requestAnswer(call.id) }
      }
      switch defaults.string(forKey: "BrigadeTestCallEndAs") {
      case "missed":
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + 0.5) { center.simulateMissed(call.id) }
      case "declined":
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + 0.5) { center.requestEnd(call.id) }
      default: break
      }
      // `double(forKey:)`: launch arguments arrive as strings.
      if defaults.object(forKey: "BrigadeTestCallRepeatAfter") != nil {
        let repeatAfter = defaults.double(forKey: "BrigadeTestCallRepeatAfter")
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + repeatAfter) { center.simulateRepeat(call.id) }
      }
      if defaults.bool(forKey: "BrigadeTestCallAck") {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + 16) {
          center.requestKey(call.id, digits: "1")
        }
      }
    }
  #endif
}
