import { expect, test } from "vite-plus/test";
import { connectParams, parseConnectLink, queryOf } from "./connect-link";

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

test("queries decode, and a bad escape is skipped", () => {
  expect([...queryOf("x://y?a=1&b=%E2%9C%93&c=%E0%A4%A&d=a+b")]).toEqual([
    ["a", "1"],
    ["b", "✓"],
    ["d", "a b"],
  ]);
});
