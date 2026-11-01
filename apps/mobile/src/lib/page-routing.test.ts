// Which instance a page goes to (RFC 0015 section 5 "Opening a page"): the tap, the Acknowledge, an answered call and
// the receipt follow the sealed origin, whichever instance the app shows; a page from an instance not on the phone
// sends nothing. The receipt's side is native (BrigadePushCrypto.swift, Pages.kt; EnvelopeV2Test.kt and
// ios/tests/main.swift cover several paired origins).
import { expect, test } from "vite-plus/test";
import {
  acknowledgeFromNotification,
  ackMutationOutcome,
  callAckRoute,
  pageInstance,
  type AckDeps,
} from "./page-action";

const shown = { id: "default", origin: "https://brigade.example.com" };
const acme = { id: "acme1", origin: "https://brigade.acme.example" };
const instances = [shown, acme];

test("a version 2 page goes to the instance it sealed, a version 1 page to the one shown", () => {
  expect(pageInstance({ origin: acme.origin }, instances, shown)).toBe(acme);
  expect(pageInstance({ origin: shown.origin }, instances, acme)).toBe(shown);
  expect(pageInstance({}, instances, acme)).toBe(acme);
  // Removed, or never added: nobody to send to.
  expect(pageInstance({ origin: "https://gone.example" }, instances, shown)).toBeUndefined();
});

/** Each instance's server and session: Acknowledge goes to `acme` with Acme's cookie, never the shown one's. */
function at(instance: { origin: string }, cookie: string, sent: string[]): AckDeps {
  return {
    url: (workspace, incident) =>
      `${instance.origin}/api/workspaces/${workspace}/incidents/${incident}/ack`,
    origin: instance.origin,
    cookie: async () => cookie,
    fetch: async (url, init) => {
      sent.push(`${url} ${new Headers(init.headers).get("cookie")}`);
      return { status: 200, json: async () => ({}) };
    },
    key: () => "ack-1",
    sleep: async () => {},
  };
}

test("the Acknowledge on a page from another instance goes there, with its session", async () => {
  const sent: string[] = [];
  const action = { incident: "inc_1", workspace: "ws_acme", origin: acme.origin };
  const target = pageInstance(action, instances, shown)!;
  expect(await acknowledgeFromNotification(action, at(target, "acme-session", sent))).toBe(
    "acknowledged",
  );
  expect(sent).toEqual([
    "https://brigade.acme.example/api/workspaces/ws_acme/incidents/inc_1/ack acme-session",
  ]);
});

test("a page from an instance no longer on the phone sends nothing", async () => {
  const sent: string[] = [];
  const action = { incident: "inc_1", workspace: "ws", origin: "https://gone.example" };
  expect(pageInstance(action, instances, shown)).toBeUndefined();
  // As src/hooks/use-page-actions.ts wires it with no instance: no URL, no origin, no session.
  const nobody: AckDeps = {
    url: () => undefined,
    cookie: async () => "",
    fetch: async (url) => {
      sent.push(url);
      return { status: 200, json: async () => ({}) };
    },
    key: () => "k",
    sleep: async () => {},
  };
  expect(await acknowledgeFromNotification(action, nobody)).toBe("signed_out");
  expect(sent).toEqual([]);
});

test("an answered call acknowledges over the socket when it is the shown instance and workspace", () => {
  expect(callAckRoute({}, instances, shown, "ws_one")).toEqual({ kind: "sync" });
  expect(
    callAckRoute({ origin: shown.origin, workspace: "ws_one" }, instances, shown, "ws_one"),
  ).toEqual({ kind: "sync" });
  // An older build's call names no workspace: the open one, as before.
  expect(callAckRoute({ origin: shown.origin }, instances, shown, "ws_one")).toEqual({
    kind: "sync",
  });
});

test("a call from another instance or workspace acknowledges over HTTPS there; from none, nowhere", () => {
  expect(
    callAckRoute({ origin: acme.origin, workspace: "ws_acme" }, instances, shown, "ws_one"),
  ).toEqual({ kind: "http", instance: acme, workspace: "ws_acme" });
  expect(
    callAckRoute({ origin: shown.origin, workspace: "ws_two" }, instances, shown, "ws_one"),
  ).toEqual({ kind: "http", instance: shown, workspace: "ws_two" });
  expect(callAckRoute({ origin: acme.origin }, instances, shown, "ws_one")).toEqual({
    kind: "none",
  });
  expect(
    callAckRoute({ origin: "https://gone.example", workspace: "ws" }, instances, shown, "ws_one"),
  ).toEqual({ kind: "none" });
});

test("the call screen reads an HTTPS ack like a mutation: already acknowledged is acknowledged", () => {
  expect(ackMutationOutcome("acknowledged")).toEqual({ ok: true, version: 0 });
  expect(ackMutationOutcome("already")).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(ackMutationOutcome("failed")).toMatchObject({ ok: false, error: { code: "closed" } });
  expect(ackMutationOutcome("signed_out")).toMatchObject({
    ok: false,
    error: { code: "forbidden" },
  });
});
