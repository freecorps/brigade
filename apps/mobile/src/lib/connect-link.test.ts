import { expect, test } from "vite-plus/test";
import {
  askFor,
  connectParams,
  linkKey,
  markScanned,
  parseConnectLink,
  queryOf,
  takeScanned,
} from "./connect-link";

const CODE = "AbCdEfGhIjKlMnOpQrSt_-";

test("the address-only link", () => {
  expect(parseConnectLink("brigade://connect?server=https%3A%2F%2Fbrigade.example.com")).toEqual({
    server: "https://brigade.example.com",
  });
  // As the dashboard writes it (URLSearchParams), and as some readers rewrite it.
  expect(parseConnectLink("brigade:///connect?server=https://brigade.example.com")).toEqual({
    server: "https://brigade.example.com",
  });
  expect(parseConnectLink("BRIGADE://connect/?server=brigade.example.com#x")).toEqual({
    server: "brigade.example.com",
  });
});

test("the sign-in link", () => {
  const link = `brigade://connect?${new URLSearchParams({ server: "https://brigade.example.com", code: CODE })}`;
  expect(parseConnectLink(link)).toEqual({ server: "https://brigade.example.com", code: CODE });
  // A code not shaped like one is no link: nothing is claimed with it.
  expect(parseConnectLink("brigade://connect?server=https://b.example&code=short")).toBeUndefined();
  expect(
    parseConnectLink(`brigade://connect?server=https://b.example&code=${CODE}x`),
  ).toBeUndefined();
  // Repeated keys keep the first.
  expect(
    parseConnectLink(
      `brigade://connect?server=https://a.example&server=https://b.example&code=${CODE}`,
    ),
  ).toEqual({ server: "https://a.example", code: CODE });
});

test("anything else is not a connect link", () => {
  for (const value of [
    "",
    "brigade://connect",
    "brigade://connect?code=" + CODE,
    "brigade://incidents/12",
    "brigade://connected?server=https://b.example",
    "otherapp://connect?server=https://b.example",
    "hello",
    "http://brigade.example.com",
  ]) {
    expect(parseConnectLink(value), value).toBeUndefined();
  }
  // A plain https address (a QR of the dashboard's address) is the address alone.
  expect(parseConnectLink("https://brigade.example.com")).toEqual({
    server: "https://brigade.example.com",
  });
});

test("route params: a param given twice is refused", () => {
  expect(connectParams("https://b.example", undefined)).toEqual({ server: "https://b.example" });
  expect(connectParams("https://b.example", CODE)).toEqual({
    server: "https://b.example",
    code: CODE,
  });
  expect(connectParams(["https://a.example", "https://b.example"], undefined)).toBeUndefined();
  expect(connectParams("https://b.example", [CODE, CODE])).toBeUndefined();
  expect(connectParams(undefined, CODE)).toBeUndefined();
  expect(connectParams("  ", undefined)).toBeUndefined();
});

test("only the scanner's own link skips the Continue, once", () => {
  const link = { server: "https://b.example", code: CODE };
  // A link from outside the app (nothing marked).
  expect(takeScanned(link)).toBe(false);
  markScanned(link);
  // Another link than the one scanned.
  expect(takeScanned({ server: "https://evil.example", code: CODE })).toBe(false);
  expect(takeScanned({ server: "https://b.example" })).toBe(false);
  expect(takeScanned(link)).toBe(true);
  // Spent: the same link opened again from outside asks first.
  expect(takeScanned(link)).toBe(false);
  expect(takeScanned(undefined)).toBe(false);
});

test("an outside link asks before any request, each link again on the same screen", () => {
  const read = (server: string) =>
    server.startsWith("https://") ? new URL(server).origin : undefined;
  const first = { server: "https://a.example", code: CODE };
  const second = { server: "https://evil.example" };
  expect(askFor(first, false, null, read)).toEqual({ host: "a.example" });
  // Approved: the first goes on.
  const approved = linkKey(first);
  expect(askFor(first, false, approved, read)).toBeUndefined();
  // A second outside link opened on the same screen asks again, approval or not.
  expect(askFor(second, false, approved, read)).toEqual({ host: "evil.example" });
  expect(askFor({ server: "https://a.example" }, false, approved, read)).toEqual({
    host: "a.example",
  });
  // The scanner's own link, and an address that does not read (refused with no request), go on.
  expect(askFor(second, true, null, read)).toBeUndefined();
  expect(askFor({ server: "not an address" }, false, null, read)).toBeUndefined();
  expect(askFor(undefined, false, null, read)).toBeUndefined();
});

test("queries decode, and a bad escape is skipped", () => {
  expect([...queryOf("x://y?a=1&b=%E2%9C%93&c=%E0%A4%A&d=a+b")]).toEqual([
    ["a", "1"],
    ["b", "✓"],
    ["d", "a b"],
  ]);
});
