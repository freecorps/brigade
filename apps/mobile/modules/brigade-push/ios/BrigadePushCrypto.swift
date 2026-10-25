// Shared by the app (the BrigadePush module) and the Notification Service Extension, which compiles this same
// file. The other side is packages/push (HPKE on WebCrypto); the envelope and constants must match it.
import CryptoKit
import Foundation
import Security

enum BrigadePushCrypto {
  /// The App Group both targets are in. App Groups double as Keychain access groups, so the extension can read the
  /// key the app created without a Keychain Sharing entitlement or the team id.
  static let appGroup = "group.app.freecorps.brigade"
  /// `PUSH_HPKE_INFO` in packages/push.
  static let info = Data("app.freecorps.brigade push v1".utf8)
  static let envelopeVersion = 1

  private static let service = "app.freecorps.brigade.push"
  private static let account = "device-key-v1"

  enum Failure: Error {
    case unsupportedOS
    case noKey
    case malformedEnvelope
    case malformedContent
    case keychain(OSStatus)
  }

  struct Content {
    let title: String
    let body: String
  }

  /// The device public key as the instance needs it: uncompressed P-256 (65 bytes), base64url. Creates the key
  /// on first use.
  static func publicKey() throws -> String {
    return base64url(try loadOrCreateKey().publicKey.x963Representation)
  }

  /// Opens the `brigade` field of a push: `{ v: 1, enc, ct }` (packages/push `PushEnvelope`).
  static func open(envelope: Any?) throws -> Content {
    guard #available(iOS 17.0, *) else { throw Failure.unsupportedOS }
    guard
      let envelope = envelope as? [String: Any],
      envelope["v"] as? Int == envelopeVersion,
      let enc = (envelope["enc"] as? String).flatMap(data(base64url:)),
      let ct = (envelope["ct"] as? String).flatMap(data(base64url:))
    else { throw Failure.malformedEnvelope }
    guard let key = try loadKey() else { throw Failure.noKey }

    // DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM: the suite packages/push seals with.
    let suite = HPKE.Ciphersuite(kem: .P256_HKDF_SHA256, kdf: .HKDF_SHA256, aead: .AES_GCM_128)
    var recipient = try HPKE.Recipient(privateKey: key, ciphersuite: suite, info: info, encapsulatedKey: enc)
    let plaintext = try recipient.open(ct)

    guard
      let json = try JSONSerialization.jsonObject(with: plaintext) as? [String: Any],
      let title = json["title"] as? String,
      let body = json["body"] as? String
    else { throw Failure.malformedContent }
    return Content(title: title, body: body)
  }

  // MARK: - Keychain

  private static func baseQuery() -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: appGroup,
    ]
  }

  private static func loadKey() throws -> P256.KeyAgreement.PrivateKey? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let raw = item as? Data else { throw Failure.keychain(status) }
    return try P256.KeyAgreement.PrivateKey(rawRepresentation: raw)
  }

  private static func loadOrCreateKey() throws -> P256.KeyAgreement.PrivateKey {
    if let key = try loadKey() { return key }
    let key = P256.KeyAgreement.PrivateKey()
    var query = baseQuery()
    query[kSecValueData as String] = key.rawRepresentation
    // Readable while the phone is locked, which is when pages arrive; never synced or restored to another device.
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(query as CFDictionary, nil)
    if status == errSecDuplicateItem, let existing = try loadKey() { return existing }
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
