import ExpoModulesCore

public class BrigadePushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BrigadePush")

    /// The device public key (base64url, uncompressed P-256) that instances seal pushes to. Created on first call.
    AsyncFunction("getPublicKey") { () throws -> String in
      return try BrigadePushCrypto.publicKey()
    }

    /// The device public key for the instance at `origin` (RFC 0015 section 4: one key per instance), created on
    /// first call; the key from before keys per instance becomes the first origin's, so its device id is kept.
    AsyncFunction("getInstancePublicKey") { (origin: String) throws -> String in
      return try BrigadePushCrypto.publicKey(origin: origin)
    }

    /// The app's handler is done with the Acknowledge action on notification `id`: ends the background time held for
    /// it (PageActions).
    Function("finishPageAction") { (id: String) in
      PageActions.shared.finish(id)
    }

    /// Adds the registered instance's origin to the paired ones, for the extension, which sends delivery receipts and
    /// opens version 2 pages only for them (RFC 0015 section 5).
    Function("setReceiptOrigin") { (origin: String) -> Bool in
      return BrigadePushCrypto.setReceiptOrigin(origin)
    }

    /// Forgets the instance at `origin` (the member signed out there), or every one when JavaScript names none: its
    /// pages show the fallback text until it registers again.
    Function("clearReceiptOrigin") { (origin: String?) in
      BrigadePushCrypto.clearReceiptOrigin(origin)
    }

    /// Paired instances are a list (`setReceiptOrigin` adds, `clearReceiptOrigin` takes an origin).
    Constant("receiptOriginList") { () -> Bool in
      return true
    }

    /// Whether this OS can decrypt pushes in the extension (HPKE needs iOS 17).
    Constant("canDecrypt") { () -> Bool in
      if #available(iOS 17.0, *) { return true }
      return false
    }
  }
}
