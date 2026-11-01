// Shared by the app (the BrigadePush module) and the Notification Service Extension, which compiles this same
// file, and the BrigadeCall pod imports it to open VoIP pushes. The other side is packages/push (HPKE on
// WebCrypto); the envelope and constants must match it, and what `open` accepts mirrors its `openOnPhone`.
import CryptoKit
import Foundation
import Security

public enum BrigadePushCrypto {
  /// The App Group both targets are in. App Groups double as Keychain access groups, so the extension can read the
  /// key the app created without a Keychain Sharing entitlement or the team id.
  static let appGroup = "group.app.freecorps.brigade"
  /// `PUSH_HPKE_INFO` in packages/push.
  static let info = Data("app.freecorps.brigade push v1".utf8)
  static let envelopeVersion = 1
  /// `PUSH_HPKE_INFO_V2` and `PUSH_ENVELOPE_V2` (RFC 0015 section 4).
  static let infoV2 = Data("app.freecorps.brigade push v2".utf8)
  static let envelopeV2 = 2
  /// `PUSH_CLOCK_SKEW_SECONDS`: how far this phone's clock may run ahead of the instance's before a page is expired.
  static let clockSkew: Int64 = 5 * 60
  /// `PUSH_MAX_TTL_SECONDS`.
  static let maxTTL: Int64 = 30 * 24 * 60 * 60
  /// `PUSH_URGENCIES`.
  static let urgencies: Set<String> = ["low", "high", "page"]

  private static let service = "app.freecorps.brigade.push"
  /// The one key from before keys per instance. The app moves it to the first origin it asks a key for
  /// (`publicKey(origin:)`), so a phone in the field keeps its key and its device id.
  private static let legacyAccount = "device-key-v1"
  /// One key per instance (RFC 0015 section 4): this prefix and the instance's origin.
  private static let instancePrefix = "device-key-v2 "

  public enum Failure: Error {
    case unsupportedOS
    case noKey
    case malformedEnvelope
    case malformedContent
    case keychain(OSStatus)
    /// v2: no key on this phone has the id the envelope names.
    case unknownKey
    /// v2: opened after its sealed `exp` (and the clock skew).
    case expired
    /// v2: sealed for another origin than the one its key belongs to.
    case wrongOrigin
    /// v2: this phone is not paired with the sealed origin.
    case notPaired
  }

  /// What a version 2 envelope seals besides the content (packages/push `PushSealed`).
  public struct Sealed {
    public let iat: Int64
    public let exp: Int64
    public let origin: String
    /// `low`, `high` or `page`: the interruption level comes from this, never from the clear `aps`.
    public let urgency: String
  }

  public struct Content {
    public let title: String
    public let body: String
    /// The incident a call's ack names (packages/push `PushContent.incident`); nil for plain alerts.
    public let incident: String?
    /// The incident's workspace (`PushContent.workspace`), for the Acknowledge action; nil from older instances.
    public let workspace: String?
    /// Where to report that this page was opened, and its single-page token (packages/push `PushReceipt`); nil when
    /// the page carries none or one the extension would not send.
    public let receipt: Receipt?
    /// What a version 2 envelope sealed; nil for version 1.
    public let sealed: Sealed?

    /// The receipt to post, if any: for v1 one on the registered instance (as before); for v2 one on the sealed
    /// origin, which `open` already checked the phone is paired with.
    public var receiptToSend: Receipt? {
      guard let receipt else { return nil }
      if let sealed {
        return Receipt.origin(of: receipt.url) == sealed.origin && BrigadePushCrypto.isPaired(sealed.origin)
          ? receipt : nil
      }
      return receipt.isForRegisteredInstance ? receipt : nil
    }
  }

  /// A delivery receipt (RFC 0006 "Delivery receipts"): an https URL and an opaque token, each at most
  /// `PUSH_RECEIPT_MAX_LENGTH` (packages/push `parseReceipt`, which this mirrors).
  public struct Receipt {
    public let url: URL
    public let token: String

    static let maxLength = 512

    init?(_ value: Any?) {
      guard
        let value = value as? [String: Any],
        let raw = value["url"] as? String,
        let token = value["token"] as? String,
        raw.count <= Self.maxLength, token.count <= Self.maxLength, !token.isEmpty,
        token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "._~-".contains($0)) }),
        let url = URL(string: raw), let host = url.host, url.user == nil, url.password == nil
      else { return nil }
      let loopback = host == "localhost" || host == "127.0.0.1"
      guard url.scheme == "https" || (url.scheme == "http" && loopback) else { return nil }
      self.url = url
      self.token = token
    }

    /// `scheme://host[:port]`, lowercased, as JavaScript's `URL.origin` says it (the default port left out); nil
    /// without a scheme or host.
    static func origin(of url: URL) -> String? {
      guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), !host.isEmpty else {
        return nil
      }
      let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
      guard let port = url.port, port != defaultPort else { return "\(scheme)://\(host)" }
      return "\(scheme)://\(host):\(port)"
    }

    /// Whether this receipt goes to the instance the app registered the phone with (`receiptOrigin()`). A page names
    /// its own receipt URL; only one on that origin is ever posted to, so a page sealed by anyone else holding the
    /// device's public key cannot make the phone call out elsewhere.
    public var isForRegisteredInstance: Bool {
      guard let registered = BrigadePushCrypto.receiptOrigin(), let origin = Self.origin(of: url) else { return false }
      return origin == registered
    }
  }

  // MARK: - Receipt origin (the paired instance)

  private static let receiptOriginKey = "receipt-origin-v1"

  /// Keeps the origin of the instance the app registered this phone with, in the App Group's defaults, where the
  /// extension reads it (RFC 0006 "Delivery receipts"). False for anything but an http(s) origin.
  public static func setReceiptOrigin(_ value: String) -> Bool {
    guard
      let origin = normalizedOrigin(value),
      let defaults = UserDefaults(suiteName: appGroup)
    else { return false }
    defaults.set(origin, forKey: receiptOriginKey)
    return true
  }

  /// The registered instance's origin; nil until the app registered the phone since it learned to keep it.
  public static func receiptOrigin() -> String? {
    return UserDefaults(suiteName: appGroup)?.string(forKey: receiptOriginKey)
  }

  /// Whether this phone is paired with `origin`: today the one instance the app registered with (one per build until
  /// several instances, RFC 0015 step 4, make it a list).
  static func isPaired(_ origin: String) -> Bool {
    return receiptOrigin() == origin
  }

  /// `value`'s origin when it is an http(s) URL; nil otherwise.
  static func normalizedOrigin(_ value: String) -> String? {
    guard let url = URL(string: value), url.scheme == "https" || url.scheme == "http" else { return nil }
    return Receipt.origin(of: url)
  }

  // MARK: - Device keys

  /// The device public key for the instance at `origin` (uncompressed P-256, 65 bytes, base64url), created on first
  /// use; the key from before keys per instance becomes the first origin's. Without an origin (JavaScript that does
  /// not know it): the paired instance's key, else the old single key, else the one instance key there is, else a new
  /// old-style key (which the first origin then adopts).
  static func publicKey(origin: String? = nil) throws -> String {
    if let origin {
      guard let origin = normalizedOrigin(origin) else { throw Failure.noKey }
      return base64url(try loadOrCreateKey(account: instancePrefix + origin, adopting: true).publicKey.x963Representation)
    }
    if let paired = receiptOrigin(), let key = try loadKey(account: instancePrefix + paired) {
      return base64url(key.publicKey.x963Representation)
    }
    if try loadKey(account: legacyAccount) == nil {
      let keys = try allKeys()
      if keys.count == 1, let only = keys.first { return base64url(only.key.publicKey.x963Representation) }
    }
    return base64url(try loadOrCreateKey(account: legacyAccount, adopting: false).publicKey.x963Representation)
  }

  /// packages/push `pushKeyId`: base64url of the first 6 bytes of SHA-256 over the uncompressed public key.
  static func keyId(_ publicKey: Data) -> String {
    return base64url(Data(SHA256.hash(data: publicKey).prefix(6)))
  }

  /// Opens the `brigade` field of a push: `{ v: 1, enc, ct }` or `{ v: 2, k, enc, ct }` (packages/push
  /// `PushEnvelope`). Every throw is the fallback text to the caller, never silence.
  public static func open(envelope: Any?, now: Date = Date()) throws -> Content {
    return try open(envelope: envelope, now: now, keys: allKeys, paired: receiptOrigin())
  }

  /// `open` with the phone's keys and paired origin given: what it checks, without the Keychain.
  static func open(
    envelope: Any?, now: Date, keys allKeys: () throws -> [(origin: String?, key: P256.KeyAgreement.PrivateKey)],
    paired: String?
  ) throws -> Content {
    guard #available(iOS 17.0, macOS 14.0, *) else { throw Failure.unsupportedOS }
    guard
      let envelope = envelope as? [String: Any],
      let version = envelope["v"] as? Int,
      version == envelopeVersion || version == envelopeV2,
      let enc = (envelope["enc"] as? String).flatMap(data(base64url:)), enc.count == 65,
      let ct = (envelope["ct"] as? String).flatMap(data(base64url:)), ct.count >= 16
    else { throw Failure.malformedEnvelope }

    if version == envelopeVersion {
      // As before keys per instance: the paired instance's key first, then any other this phone has.
      let keys = try allKeys()
      guard !keys.isEmpty else { throw Failure.noKey }
      let ordered = keys.filter { $0.origin != nil && $0.origin == paired } + keys.filter { $0.origin == nil || $0.origin != paired }
      var lastError: Error = Failure.noKey
      for entry in ordered {
        do {
          let json = try openJSON(key: entry.key, info: info, enc: enc, ct: ct)
          return try content(json, sealed: nil)
        } catch {
          lastError = error
        }
      }
      throw lastError
    }

    guard let k = envelope["k"] as? String, k.count == 8 else { throw Failure.malformedEnvelope }
    guard let entry = try allKeys().first(where: { keyId($0.key.publicKey.x963Representation) == k }) else {
      throw Failure.unknownKey
    }
    let json = try openJSON(key: entry.key, info: infoV2, enc: enc, ct: ct)
    guard let sealed = sealed(json) else { throw Failure.malformedContent }
    let opened = try content(json, sealed: sealed)
    if Int64(now.timeIntervalSince1970) > sealed.exp + clockSkew { throw Failure.expired }
    // The unclaimed key from before keys per instance counts as the paired instance's.
    if let origin = entry.origin, origin != sealed.origin { throw Failure.wrongOrigin }
    guard paired == sealed.origin else { throw Failure.notPaired }
    return opened
  }

  @available(iOS 17.0, macOS 14.0, *)
  private static func openJSON(
    key: P256.KeyAgreement.PrivateKey, info: Data, enc: Data, ct: Data
  ) throws -> [String: Any] {
    // DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM: the suite packages/push seals with.
    let suite = HPKE.Ciphersuite(kem: .P256_HKDF_SHA256, kdf: .HKDF_SHA256, aead: .AES_GCM_128)
    var recipient = try HPKE.Recipient(privateKey: key, ciphersuite: suite, info: info, encapsulatedKey: enc)
    let plaintext = try recipient.open(ct)
    guard let json = try JSONSerialization.jsonObject(with: plaintext) as? [String: Any] else {
      throw Failure.malformedContent
    }
    return json
  }

  private static func content(_ json: [String: Any], sealed: Sealed?) throws -> Content {
    guard let title = json["title"] as? String, let body = json["body"] as? String else {
      throw Failure.malformedContent
    }
    return Content(
      title: title, body: body, incident: json["incident"] as? String, workspace: json["workspace"] as? String,
      receipt: Receipt(json["receipt"]), sealed: sealed)
  }

  /// packages/push `parseSealed`: whole seconds, `iat <= exp <= iat + 30 days`, an origin in `URL.origin` form, a
  /// known urgency.
  private static func sealed(_ json: [String: Any]) -> Sealed? {
    guard
      let iat = integer(json["iat"]), let exp = integer(json["exp"]),
      iat >= 0, exp >= iat, exp - iat <= maxTTL,
      let origin = json["origin"] as? String, normalizedOrigin(origin) == origin,
      let urgency = json["urgency"] as? String, urgencies.contains(urgency)
    else { return nil }
    return Sealed(iat: iat, exp: exp, origin: origin, urgency: urgency)
  }

  /// A JSON integer (not a fraction, not a boolean).
  private static func integer(_ value: Any?) -> Int64? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let double = number.doubleValue
    guard double.rounded() == double, abs(double) < 9_007_199_254_740_992 else { return nil }
    return number.int64Value
  }

  // MARK: - Keychain

  private static func baseQuery(account: String? = nil) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccessGroup as String: appGroup,
    ]
    if let account { query[kSecAttrAccount as String] = account }
    return query
  }

  private static func loadKey(account: String) throws -> P256.KeyAgreement.PrivateKey? {
    var query = baseQuery(account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let raw = item as? Data else { throw Failure.keychain(status) }
    return try P256.KeyAgreement.PrivateKey(rawRepresentation: raw)
  }

  /// Every device key on this phone and its instance's origin (nil for the unclaimed key from before keys per
  /// instance). Attributes first, then each key on its own: one unreadable item never hides the others.
  private static func allKeys() throws -> [(origin: String?, key: P256.KeyAgreement.PrivateKey)] {
    var query = baseQuery()
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    var items: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &items)
    if status == errSecItemNotFound { return [] }
    guard status == errSecSuccess, let list = items as? [[String: Any]] else { throw Failure.keychain(status) }
    var keys: [(origin: String?, key: P256.KeyAgreement.PrivateKey)] = []
    for attributes in list {
      guard let account = attributes[kSecAttrAccount as String] as? String else { continue }
      let origin: String?
      if account == legacyAccount {
        origin = nil
      } else if account.hasPrefix(instancePrefix) {
        origin = String(account.dropFirst(instancePrefix.count))
      } else {
        continue
      }
      if let key = try? loadKey(account: account) { keys.append((origin, key)) }
    }
    return keys
  }

  /// The key under `account`, made if there is none. `adopting`: the key from before keys per instance moves to
  /// `account` instead (the same key, so the same device id), in one Keychain update the extension never sees half
  /// done.
  private static func loadOrCreateKey(account: String, adopting: Bool) throws -> P256.KeyAgreement.PrivateKey {
    if let key = try loadKey(account: account) { return key }
    if adopting, try loadKey(account: legacyAccount) != nil {
      let status = SecItemUpdate(
        baseQuery(account: legacyAccount) as CFDictionary,
        [kSecAttrAccount as String: account] as CFDictionary)
      if status == errSecSuccess || status == errSecDuplicateItem, let key = try loadKey(account: account) {
        return key
      }
    }
    let key = P256.KeyAgreement.PrivateKey()
    var query = baseQuery(account: account)
    query[kSecValueData as String] = key.rawRepresentation
    // Readable while the phone is locked, which is when pages arrive; never synced or restored to another device.
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(query as CFDictionary, nil)
    if status == errSecDuplicateItem, let existing = try loadKey(account: account) { return existing }
    guard status == errSecSuccess else { throw Failure.keychain(status) }
    return key
  }

  // MARK: - base64url

  static func base64url(_ data: Data) -> String {
    return data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func data(base64url value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
  }
}
