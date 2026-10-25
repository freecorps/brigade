import ExpoModulesCore

/// The JS side of the call screen (modules/brigade-call/index.ts).
public class BrigadeCallModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BrigadeCall")

    Events("onAnswer", "onEnd", "onAcknowledgeKey", "onSpoken")

    OnCreate {
      CallCenter.shared.start()
      CallCenter.shared.emit = { [weak self] name, body in
        self?.sendEvent(name, body.compactMapValues { $0 })
      }
    }

    OnDestroy {
      CallCenter.shared.emit = nil
    }

    /// CallKit always rings; if it refuses a call, the page becomes a time-sensitive notification.
    Function("getRingStatus") { () -> [String: Any] in
      return ["route": "ring"]
    }

    Function("getAnsweredCall") { () -> [String: Any]? in
      return CallCenter.shared.answeredCall?.dictionary.compactMapValues { $0 }
    }

    Function("simulateIncomingCall") { (title: String, body: String, incident: String?, delayMs: Int) -> String in
      let call = IncomingCall(id: UUID(), title: title, body: body, incident: incident)
      CallCenter.shared.simulate(call, after: Double(delayMs) / 1000)
      return call.id.uuidString.lowercased()
    }

    Function("endCall") { (id: String) in
      if let uuid = UUID(uuidString: id) { CallCenter.shared.requestEnd(uuid) }
    }

    Function("speak") { (text: String, language: String) in
      CallCenter.shared.speak(text, language: language)
    }

    Function("stopSpeaking") {
      CallCenter.shared.stopSpeaking()
    }

    Function("openFullScreenIntentSettings") {}

    /// The PushKit token the relay sends calls to (hex), or null until PushKit has one.
    AsyncFunction("getVoipToken") { () -> String? in
      return CallCenter.shared.voipToken
    }
  }
}
