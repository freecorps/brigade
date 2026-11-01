// What BrigadePushCrypto.swift accepts and refuses (RFC 0015 section 4), against envelopes sealed by packages/push.
// macOS only (CryptoKit's HPKE, no Keychain: the keys and the paired origin are given), run by hand, never in CI:
//
//   xcrun swiftc -o /tmp/brigade-push-tests \
//     apps/mobile/modules/brigade-push/ios/tests/main.swift apps/mobile/modules/brigade-push/ios/BrigadePushCrypto.swift
//   /tmp/brigade-push-tests
//
// The pod compiles `ios/*.swift` only, so this folder stays out of the app and the extension. The page envelope is
// the one EnvelopeV2Test.kt opens, sealed to RFC 9180 vector A.3.1's recipient.
import CryptoKit
import Foundation

var failures = 0
func check(_ name: String, _ condition: Bool) {
  print("\(condition ? "ok  " : "FAIL") \(name)")
  if !condition { failures += 1 }
}

func hex(_ value: String) -> Data {
  var data = Data()
  var index = value.startIndex
  while index < value.endIndex {
    let next = value.index(index, offsetBy: 2)
    data.append(UInt8(value[index..<next], radix: 16)!)
    index = next
  }
  return data
}

let origin = "https://brigade.example.com"
let other = "https://other.example.org"
let iat: TimeInterval = 1_793_534_400
let device = try! P256.KeyAgreement.PrivateKey(
  rawRepresentation: hex("f3ce7fdae57e1a310d87f1ebbde6f328be0a99cdbcadf4d6589cf29de4b8ffd2"))
let stranger = P256.KeyAgreement.PrivateKey()

/// packages/push `sealPushV2`, origin above, TTL 900 s, sealed at `iat`: urgency `page` (EnvelopeV2Test.kt's) and `low`.
let page: [String: Any] = [
  "v": 2, "k": "hxDO5Zz-",
  "enc": "BPppWodapKGlveMp3Ry5ZM2Lnhy3ftqP5VFxsfQyxPiqO9_LCj1qYwX39toMeiP96tKmmsk8cKWZCEXfd1tvDfY",
  "ct":
    "SKjySqT-8uTvRjKGS8_z76JiCpJJDkC_rOluMhoeZXoISmT1HghmerBxBMPw0xLXOFuDy9SOIicLT4lm0DyIW-uQu81ZN1NDpW70PHlQhjicaRdNAUzqVYFHoSdNvSqydF-T4TvVTEsxkr-vSOuvg8vfz1BkQrmBCRMv0i1Eq0vvhBSyl4X8eQiIE4vyEJKGaEhB2mQhsNsxB4SR811laxo0keVyJNthGpDxwdNu8n3LGPrlmVFLOhxFL5KKNEKegdJGBjoMF3WRaOFu2xWRi8PAw0M7r9lrvDae0fA34Yp2JU0IZ5T3EveQatckzjsTFEdgcWhhQb8b5a9v9_xLdXqZhktvTPN8aGhkVakHYbj8uIs",
]
let low: [String: Any] = [
  "v": 2, "k": "hxDO5Zz-",
  "enc": "BMCa3KLF2bSrnQszb2qwSEGP0eeCcV8Y2bHY_Dw8Cg1grW0hQ8y4JYBVEOoEZg0pCHXh5JCisw7g_ep9ALqq4tA",
  "ct":
    "J8AMNwfXwh6BRezTaBg7MHle4F-xzMJBuljtGV7AfMnh4PMwi26qI8XPx3uJdg7QY7Ym47tTTJLXP5cl9aj4p9UP28MaUX54XFnaYpEzzSrzw04hfMuqqyLVd4BGKVQjq2KoS3lflq18ADG7J4_LDjwiEOrLRqbR1Xj08WlTscxWJSzkaR2HTOyZXW_DXhC1A0C1OHyCxxw",
]

typealias Keys = [(origin: String?, key: P256.KeyAgreement.PrivateKey)]
let mine: Keys = [(other, stranger), (origin, device)]

/// The content, or the error `open` threw.
func open(
  _ envelope: Any?, at offset: TimeInterval = 60, keys: Keys = mine, paired: String? = origin
) -> Result<BrigadePushCrypto.Content, Error> {
  Result {
    try BrigadePushCrypto.open(
      envelope: envelope, now: Date(timeIntervalSince1970: iat + offset), keys: { keys }, paired: paired)
  }
}

func refusal(_ result: Result<BrigadePushCrypto.Content, Error>) -> BrigadePushCrypto.Failure? {
  if case .failure(let error) = result { return error as? BrigadePushCrypto.Failure }
  return nil
}

// Opens, with what it sealed.
if case .success(let content) = open(page) {
  check("opens the page", content.title == "SEV1 · INC-142" && content.incident == "inc_1")
  check(
    "sealed fields", content.sealed?.origin == origin && content.sealed?.urgency == "page"
      && content.sealed?.iat == Int64(iat) && content.sealed?.exp == Int64(iat) + 900)
} else {
  check("opens the page", false)
}
check("within the clock skew", (try? open(page, at: 900 + 300).get()) != nil)
check("the unclaimed old key counts as the paired instance's", (try? open(page, keys: [(nil, device)]).get()) != nil)

// Each refusal (every one is the fallback text in the extension).
if case .expired = refusal(open(page, at: 900 + 301)) { check("expired", true) } else { check("expired", false) }
if case .wrongOrigin(let urgency) = refusal(open(page, keys: [(other, device)])) {
  check("wrong origin, with the sealed urgency", urgency == "page")
} else {
  check("wrong origin, with the sealed urgency", false)
}
if case .notPaired = refusal(open(page, paired: other)) { check("not paired", true) } else { check("not paired", false) }
if case .notPaired = refusal(open(page, paired: nil)) { check("not paired at all", true) } else { check("not paired at all", false) }
if case .unknownKey = refusal(open(page, keys: [(origin, stranger)])) { check("unknown key", true) } else { check("unknown key", false) }
if case .unknownKey = refusal(open(page, keys: [])) { check("no keys", true) } else { check("no keys", false) }
var relabelled = page
relabelled["v"] = 1
check("a v2 ciphertext does not open as v1", (try? open(relabelled).get()) == nil)
var badId = page
badId["k"] = "short"
if case .malformedEnvelope = refusal(open(badId)) { check("malformed key id", true) } else { check("malformed key id", false) }

// How loud the fallback may be: the sealed urgency once it opened, else the delivered level (nil).
func urgency(_ result: Result<BrigadePushCrypto.Content, Error>) -> String? {
  if case .failure(let error) = result { return BrigadePushCrypto.fallbackUrgency(for: error) }
  return nil
}
check("not paired low: no louder than low", urgency(open(low, paired: other)) == "low")
check("wrong origin low: no louder than low", urgency(open(low, keys: [(other, device)])) == "low")
check("expired low: loud (delivered level)", urgency(open(low, at: 3600)) == nil)
check("unknown key: loud (delivered level)", urgency(open(low, keys: [(origin, stranger)])) == nil)
check("not opened: loud (delivered level)", urgency(open(relabelled)) == nil)

// Key id and origins, as packages/push and JavaScript's URL.origin.
var vector = Data([4])
vector.append(contentsOf: (1...64).map { UInt8($0) })
check("key id vector", BrigadePushCrypto.keyId(vector) == "DtOmq5V_")
check("key id of the device key", BrigadePushCrypto.keyId(device.publicKey.x963Representation) == "hxDO5Zz-")
let origins: [(String, String?)] = [
  ("https://Brigade.Example.com/api/auth", "https://brigade.example.com"),
  ("https://brigade.example.com:443/x", "https://brigade.example.com"),
  ("http://localhost:8787/api", "http://localhost:8787"),
  ("http://[::1]:8787/api", "http://[::1]:8787"),
  ("https://[2001:db8::1]/", "https://[2001:db8::1]"),
  ("https://my_host.internal/", "https://my_host.internal"),
  ("ftp://brigade.example.com", nil),
]
for (url, expected) in origins {
  check("origin of \(url)", BrigadePushCrypto.normalizedOrigin(url) == expected)
}

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
