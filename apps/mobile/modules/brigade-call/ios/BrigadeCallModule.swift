import ExpoModulesCore

/// The JS side of the call screen (modules/brigade-call/index.ts).
public class BrigadeCallModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BrigadeCall")

    Events("onAnswer", "onEnd", "onAcknowledgeKey", "onSpoken", "onVoipToken")

    OnCreate {
      CallCenter.shared.start()
      CallCenter.shared.emit = { [weak self] name, body in
        self?.sendEvent(name, body.compactMapValues { $0 })
      }
    }

    OnDestroy {
      CallCenter.shared.emit = nil
    }

    // Sync functions run on the JS thread (`@JavaScriptActor` in expo-modules-core 58), never the main thread, and
    // `CallCenter` lives on the main queue. So reads use its locked snapshot and writes are dispatched to main
    // asynchronously. Not `DispatchQueue.main.sync`: React Native's renderer can block the main thread on the JS
    // thread (RuntimeExecutor's "executeSynchronouslyOnSameThread_CAN_DEADLOCK"), and the two would wait forever.

    /// CallKit always rings; if it refuses a call, the page becomes a time-sensitive notification.
    Function("getRingStatus") { () -> [String: Any] in
      return ["route": "ring"]
    }

    /// With `ackKeyPressed` if 1 was pressed before JavaScript listened: the hook acknowledges on mount.
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
      DispatchQueue.main.async { CallCenter.shared.speak(text, language: language) }
    }

    Function("stopSpeaking") {
      DispatchQueue.main.async { CallCenter.shared.stopSpeaking() }
    }

    Function("openFullScreenIntentSettings") {}

    /// Leaves a folder of the app's, and what is in it, out of iCloud and computer backups: the queue of changes not
    /// sent yet (src/lib/pending-files.ts) holds what members wrote about incidents. Takes a `file://` URL.
    Function("excludeFromBackup") { (uri: String) throws in
      // Throws rather than quietly succeeding: the caller keeps trying on its next write until the flag is set.
      guard var url = URL(string: uri), url.isFileURL else {
        throw NSError(
          domain: "BrigadeCall", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Not a file URL: the folder was not excluded from backup"])
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }

    /// The PushKit token the relay sends calls to (hex), waiting a few seconds for PushKit after launch; null if it
    /// has none.
    AsyncFunction("getVoipToken") { (promise: Promise) in
      CallCenter.shared.waitForVoipToken(timeout: 5) { promise.resolve($0 as Any?) }
    }.runOnQueue(.main)
  }
}
