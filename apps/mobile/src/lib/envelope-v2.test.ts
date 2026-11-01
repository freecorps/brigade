// Envelope version 2 on the phone (RFC 0015 section 4). The behaviour is tested where it runs: packages/push
// `openOnPhone` (the reference), the Kotlin on the JVM (EnvelopeV2Test.kt). The Swift has no tests in CI, so these
// checks pin the native sources to packages/push and to the paging path's rule: every refusal is the fallback text,
// never silence (RFC 0006).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const push = read("../../../../packages/push/src/envelope.ts");
const crypto = read("../../modules/brigade-push/ios/BrigadePushCrypto.swift");
const extension = read("../../modules/brigade-push/extension/NotificationService.swift");
const callCenter = read("../../modules/brigade-call/ios/CallCenter.swift");
const android = "../../modules/brigade-push/android/src/main/java/app/freecorps/brigade/push/";
const payload = read(`${android}PushPayload.kt`);
const pages = read(`${android}Pages.kt`);
const deviceKey = read(`${android}DeviceKey.kt`);
const kotlinTest = read(
  "../../modules/brigade-push/android/src/test/java/app/freecorps/brigade/push/EnvelopeV2Test.kt",
);
const pushTest = read("../../../../packages/push/tests/envelope-v2.test.ts");

/** A `export const NAME = "value"` (or a number) from packages/push. */
function constant(name: string): string {
  const match = new RegExp(`export const ${name} = ([^;]+);`).exec(push);
  if (!match) throw new Error(`no ${name} in packages/push`);
  return match[1]!.trim();
}

describe("the native code matches packages/push", () => {
  test("HPKE info of both versions", () => {
    const v1 = JSON.parse(constant("PUSH_HPKE_INFO")) as string;
    const v2 = JSON.parse(constant("PUSH_HPKE_INFO_V2")) as string;
    expect(v2).toBe("app.freecorps.brigade push v2");
    expect(crypto).toContain(`static let info = Data("${v1}".utf8)`);
    expect(crypto).toContain(`static let infoV2 = Data("${v2}".utf8)`);
    expect(payload).toContain(`val PUSH_HPKE_INFO = "${v1}".toByteArray()`);
    expect(payload).toContain(`val PUSH_HPKE_INFO_V2 = "${v2}".toByteArray()`);
  });

  test("clock skew, longest TTL and urgencies", () => {
    expect(constant("PUSH_CLOCK_SKEW_SECONDS")).toBe("5 * 60");
    expect(constant("PUSH_MAX_TTL_SECONDS")).toBe("30 * 24 * 60 * 60");
    expect(crypto).toContain("static let clockSkew: Int64 = 5 * 60");
    expect(crypto).toContain("static let maxTTL: Int64 = 30 * 24 * 60 * 60");
    expect(payload).toContain("const val CLOCK_SKEW_SECONDS = 5L * 60");
    expect(payload).toContain("const val MAX_TTL_SECONDS = 30L * 24 * 60 * 60");
    expect(crypto).toContain('static let urgencies: Set<String> = ["low", "high", "page"]');
    expect(payload).toContain('val URGENCIES = setOf("low", "high", "page")');
  });

  test("the key id: SHA-256's first 6 bytes, the same vector on every side", () => {
    expect(crypto).toContain("base64url(Data(SHA256.hash(data: publicKey).prefix(6)))");
    expect(payload).toContain("digest(publicKey).copyOfRange(0, 6)");
    const vector = /const KEY_ID_VECTOR = "([^"]+)"/.exec(pushTest)?.[1];
    expect(vector).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(kotlinTest).toContain(`"${vector}"`);
  });
});

describe("every refusal is the fallback text, never silence", () => {
  test("iOS: each v2 refusal throws, and the extension shows the fallback for any throw", () => {
    for (const refusal of ["unknownKey", "expired", "wrongOrigin", "notPaired"]) {
      expect(crypto).toContain(`throw Failure.${refusal}`);
    }
    // The order packages/push checks in: expired, then the key's origin, then pairing.
    const order = [
      "throw Failure.expired",
      "throw Failure.wrongOrigin",
      "throw Failure.notPaired",
    ].map((s) => crypto.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Every throw ends in a fallback: capped (`deliver(capped)`) or as delivered (`deliver(fallback)`).
    const caught = /\} catch \{([\s\S]*?)\n {4}\}\n {2}\}/.exec(extension)?.[1] ?? "";
    expect(caught).toContain("return deliver(capped)");
    expect(caught.trimEnd().endsWith("deliver(fallback)")).toBe(true);
    // A call already reported to CallKit keeps its fallback name when refused.
    expect(callCenter).toMatch(/\} catch \{\s*log\.error\("voip push not decrypted/);
  });

  test("Android: a refused v2 page opens to no content, and no content is the fallback notification", () => {
    expect(pages).toContain("val refusal = PushChecks.refusal(");
    expect(pages).toMatch(/if \(refusal != null\) \{[^}]*Opened\(null, sealed, refusal\)\s*\}/);
    expect(pages).toContain('?: throw IllegalStateException("unknown key id")');
    expect(pages).toMatch(/if \(message == null\) \{[\s\S]*?notify\(context, null, null, true\)/);
    expect(pages).toMatch(
      /if \(content == null \|\| sealedNotPage\) \{[\s\S]*?notify\(context, null, message\.tag, page\)/,
    );
    for (const refusal of ["expired", "wrong_origin", "not_paired"]) {
      expect(payload).toContain(`return "${refusal}"`);
    }
  });
});

describe("what a v2 page decides", () => {
  test("the interruption level and channel come from the sealed urgency", () => {
    expect(extension).toContain(
      "if let sealed = decrypted.sealed { Self.applyUrgency(sealed.urgency, to: content) }",
    );
    expect(pages).toContain(
      "val page = PushChecks.isPage(message.isPage, opened.sealed, opened.refusal)",
    );
  });

  test("a refused push that opened is no louder than sealed; expired and unopened stay loud", () => {
    // iOS: only the two refusals after the AEAD carry the sealed urgency, and only they cap the fallback.
    expect(crypto).toContain(
      "case .wrongOrigin(let urgency), .notPaired(let urgency): return urgency",
    );
    expect(crypto).toContain("throw Failure.wrongOrigin(urgency: sealed.urgency)");
    expect(crypto).toContain("throw Failure.notPaired(urgency: sealed.urgency)");
    expect(crypto).toMatch(
      /if Int64\(now\.timeIntervalSince1970\) > sealed\.exp \+ clockSkew \{ throw Failure\.expired \}/,
    );
    expect(extension).toMatch(
      /if let urgency = BrigadePushCrypto\.fallbackUrgency\(for: error\),[\s\S]*?Self\.applyUrgency\(urgency, to: capped\)/,
    );
    // Android: the same rule in one place (EnvelopeV2Test.kt runs it).
    expect(payload).toContain(
      'if (sealed != null && refusal != "expired") sealed.isPage else clearIsPage',
    );
  });

  test("iOS: a call sealed as less than a page is reported first, then ended and shown as the fallback", () => {
    const receive = callCenter.slice(
      callCenter.indexOf("private func receive("),
      callCenter.indexOf("// MARK: - Calls"),
    );
    // Reported to CallKit before decrypting (iOS stops VoIP pushes to an app that does not), on every branch.
    expect(receive.indexOf("case .new: report(call")).toBeLessThan(
      receive.indexOf("BrigadePushCrypto.open("),
    );
    // Only this push's own new call is ended: a repeat never ends a call an earlier page rang.
    expect(receive).toContain("if case .new = kind { endNotAPage(id) }");
    // A call that opened and was refused (wrong origin, not paired) is no louder than it sealed either.
    expect(receive).toMatch(
      /if let urgency = BrigadePushCrypto\.fallbackUrgency\(for: error\), urgency != "page", case \.new = kind \{\s*endNotAPage\(id\)/,
    );
    // Ended once CallKit has it, from the report's success; refused by CallKit, the fallback text, not a page.
    expect(callCenter).toMatch(
      /if self\.calls\[call\.id\]\?\.notAPage == true \{\s*self\.finishNotAPage\(call\.id\)/,
    );
    expect(callCenter).toContain(
      "if tracked.notAPage { self.notifyNotAPage(tracked) } else { self.notifyPage(tracked) }",
    );
    expect(callCenter).toMatch(/private func finishNotAPage[\s\S]*?notifyNotAPage\(call\)/);
    // The page CallKit's fallback posts carries the sealed origin for the Acknowledge.
    expect(callCenter).toContain("origin: content.sealed?.origin)");
    expect(callCenter).toContain(
      "BrigadePage.mark(content, incident: call.incident, workspace: call.workspace, origin: call.origin)",
    );
  });

  test("signing out of an instance forgets only that one on the native side", () => {
    const session = read("../components/session.tsx");
    expect(session).toMatch(
      /async function forgetMember[\s\S]*?BrigadePush\?\.clearReceiptOrigin\?\.\(clients\.instance\.origin\)/,
    );
    expect(read("../../modules/brigade-push/ios/BrigadePushModule.swift")).toContain(
      'Function("clearReceiptOrigin") { (origin: String?) in',
    );
    expect(read(`${android}BrigadePushModule.kt`)).toContain(
      'Function("clearReceiptOrigin") { origin: String? ->',
    );
  });

  test("receipts only to the sealed origin, only when paired with it (one of several)", () => {
    expect(extension).toContain("if let receipt = decrypted.receiptToSend {");
    expect(crypto).toMatch(
      /Receipt\.origin\(of: receipt\.url\) == sealed\.origin && BrigadePushCrypto\.isPaired\(sealed\.origin\)/,
    );
    expect(crypto).toContain("return receiptOrigins().contains(origin)");
    expect(crypto).toContain("guard paired.contains(sealed.origin) else");
    expect(pages).toContain("PushChecks.receiptToSend(content, receiptOrigins(context))");
    expect(payload).toContain(
      "receipt.takeIf { it.origin == sealed.origin && sealed.origin in paired }",
    );
    expect(payload).toContain('if (sealed.origin !in paired) return "not_paired"');
  });
});

describe("one key per instance, and phones in the field keep theirs", () => {
  test("iOS: the old Keychain item moves to the first origin's account in one update", () => {
    expect(crypto).toContain('private static let legacyAccount = "device-key-v1"');
    expect(crypto).toContain('private static let service = "app.freecorps.brigade.push"');
    expect(crypto).toMatch(/SecItemUpdate\(\s*baseQuery\(account: legacyAccount\)/);
  });

  test("Android: the old Keystore alias and wrapped file stay where they were, claimed by the first origin", () => {
    for (const name of [
      '"app.freecorps.brigade.push.device-key.v1"',
      '"app.freecorps.brigade.push.wrap-key.v1"',
      '"brigade-device-key-v1"',
    ]) {
      expect(deviceKey).toContain(name);
    }
    // Only the paired instance (or any, when none is) takes it: EnvelopeV2Test.kt runs the rule.
    expect(deviceKey).toContain(
      "if (KeyChecks.mayTakeLegacy(claimed, Pages.receiptOrigin(context), origin)) {",
    );
    expect(crypto).toContain(
      "let adopting = mayAdoptLegacy(paired: receiptOrigin(), origin: origin)",
    );
  });
});
