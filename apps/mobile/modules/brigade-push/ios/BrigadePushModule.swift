import ExpoModulesCore

public class BrigadePushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BrigadePush")

    /// The device public key (base64url, uncompressed P-256) that instances seal pushes to. Created on first call.
    AsyncFunction("getPublicKey") { () throws -> String in
      return try BrigadePushCrypto.publicKey()
    }

    /// The app's handler is done with the Acknowledge action on notification `id`: ends the background time held for
    /// it (PageActions).
    Function("finishPageAction") { (id: String) in
      PageActions.shared.finish(id)
    }

    /// Whether this OS can decrypt pushes in the extension (HPKE needs iOS 17).
    Constant("canDecrypt") { () -> Bool in
      if #available(iOS 17.0, *) { return true }
      return false
    }
  }
}
