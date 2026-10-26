import { expect, test } from "vite-plus/test";
import {
  encode,
  MAX_CLIENT_MESSAGE_LENGTH,
  parseClientMessage,
  parseServerMessage,
  PING_FRAME,
  PONG_FRAME,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "../src/protocol.ts";

const row = { id: "inc_1", title: "Checkout is down", number: null };

test("server messages round-trip through encode and parse", () => {
  const messages: ServerMessage[] = [
    { type: "snapshot", subId: "s0", epoch: "ep_1", version: 0, rows: [row] },
    {
      type: "patch",
      epoch: "ep_1",
      version: 3,
      subs: {
        s0: { upserts: [row], deletes: ["inc_2"] },
        s1: { upserts: [], deletes: ["inc_1"] },
      },
    },
    { type: "mutationResult", mutationId: "mut_1", ok: true, version: 4 },
    {
      type: "mutationResult",
      mutationId: "mut_2",
      ok: false,
      error: {
        code: "invalid_args",
        message: "Invalid",
        issues: [{ path: "title", message: "Too long" }],
      },
    },
    { type: "error", code: "forbidden", message: "No", subId: "s1" },
    { type: "error", code: "protocol", message: "Frame too large", mutationId: "mut_3" },
    { type: "error", code: "protocol", message: "Unsupported protocol" },
  ];
  for (const message of messages) {
    const parsed = parseServerMessage(encode(message));
    expect(parsed.ok).toBe(true);
    // `subs` comes back without a prototype; compare its content.
    expect(JSON.parse(JSON.stringify(parsed.ok && parsed.message))).toEqual(message);
  }
});

test("a patch keeps a subId like __proto__ as an ordinary key", () => {
  const parsed = parseServerMessage(
    '{"type":"patch","epoch":"e","version":1,"subs":{"__proto__":{"upserts":[],"deletes":["x"]}}}',
  );
  if (!parsed.ok || parsed.message.type !== "patch") throw new Error("expected a patch");
  const subs = parsed.message.subs;
  expect(Object.keys(subs)).toEqual(["__proto__"]);
  expect(Object.prototype.hasOwnProperty.call(subs, "__proto__")).toBe(true);
  expect(subs["__proto__"]?.deletes).toEqual(["x"]);
});

test("client messages round-trip through encode and parse", () => {
  const messages: ClientMessage[] = [
    { type: "hello", protocol: PROTOCOL_VERSION, clientId: "cli_1" },
    { type: "hello", protocol: PROTOCOL_VERSION, clientId: "cli_1", token: "t" },
    { type: "subscribe", subId: "s0", query: "incidents.active", args: {} },
    {
      type: "subscribe",
      subId: "s0",
      query: "incidents.active",
      args: {},
      version: 7,
      epoch: "ep_1",
    },
    { type: "unsubscribe", subId: "s0" },
    { type: "mutate", mutationId: "mut_1", name: "incident.declare", args: { id: "inc_1" } },
    // Names are not capped here (runMutation clips what it echoes); the frame size bounds them.
    { type: "mutate", mutationId: "mut_2", name: "x".repeat(1000), args: {} },
  ];
  for (const message of messages) {
    expect(parseClientMessage(encode(message))).toEqual({ ok: true, message });
  }
});

test("malformed frames are refused with a reason, never thrown", () => {
  const bad: unknown[] = [
    undefined,
    42,
    new ArrayBuffer(4),
    "",
    "{",
    "[]",
    '"snapshot"',
    JSON.stringify({ type: "snapshot", subId: "s 0", version: 1, rows: [] }),
    JSON.stringify({ type: "snapshot", subId: "s0", epoch: "e", version: 1.5, rows: [] }),
    JSON.stringify({ type: "snapshot", subId: "s0", epoch: "e", version: 2 ** 53, rows: [] }),
    JSON.stringify({ type: "snapshot", subId: "s0", epoch: "e", version: 1, rows: {} }),
    JSON.stringify({ type: "snapshot", subId: "s0", epoch: "e", version: 1, rows: [[]] }),
    JSON.stringify({ type: "snapshot", subId: "s0", epoch: "e", version: 1, rows: [{ id: "" }] }),
    // The per-subscription patch of an earlier draft.
    JSON.stringify({ type: "patch", subId: "s0", version: 1, upserts: [], deletes: [] }),
    JSON.stringify({ type: "patch", epoch: "e", version: 1, subs: [] }),
    // No epoch, or an epoch that is not a token.
    JSON.stringify({ type: "patch", version: 1, subs: {} }),
    JSON.stringify({ type: "snapshot", subId: "s0", epoch: "", version: 1, rows: [] }),
    JSON.stringify({
      type: "patch",
      epoch: "e",
      version: 1,
      subs: { "s 0": { upserts: [], deletes: [] } },
    }),
    JSON.stringify({
      type: "patch",
      epoch: "e",
      version: 1,
      subs: { s0: { upserts: [], deletes: null } },
    }),
    JSON.stringify({ type: "patch", epoch: "e", version: 1, subs: { s0: { upserts: [] } } }),
    // Deleted ids follow the row id rule: non-empty strings.
    JSON.stringify({
      type: "patch",
      epoch: "e",
      version: 1,
      subs: { s0: { upserts: [], deletes: [""] } },
    }),
    JSON.stringify({
      type: "patch",
      epoch: "e",
      version: 1,
      subs: { s0: { upserts: [], deletes: [], x: 1 } },
    }),
    JSON.stringify({ type: "mutationResult", mutationId: "m", ok: true }),
    JSON.stringify({ type: "mutationResult", mutationId: "m", ok: false, error: "x" }),
    JSON.stringify({
      type: "mutationResult",
      mutationId: "m",
      ok: false,
      error: { code: "conflict" },
    }),
    JSON.stringify({
      type: "mutationResult",
      mutationId: "m",
      ok: false,
      error: { code: "conflict", message: "x", issues: [{ path: "a", message: "b", extra: 1 }] },
    }),
    JSON.stringify({ type: "error", code: 1, message: "x" }),
    JSON.stringify({ type: "error", code: "x", message: "x", mutationId: "m m" }),
    JSON.stringify({ type: "__proto__" }),
    '{"type":"snapshot","subId":"s0","version":1,"rows":[],"__proto__":{"x":1}}',
  ];
  for (const frame of bad) {
    const parsed = parseServerMessage(frame);
    expect(parsed.ok, String(frame)).toBe(false);
    expect(parseClientMessage(frame).ok).toBe(false);
  }
  expect(parseServerMessage("[]")).toEqual({ ok: false, reason: "frames must be JSON objects" });
});

test("the client parser bounds what a client can send", () => {
  const frame = (args: string) => encode({ type: "mutate", mutationId: "m", name: "x", args });
  const overhead = frame("").length;
  // The limit is the frame's length in UTF-16 code units, the same measure the client checks before sending.
  expect(parseClientMessage(frame("a".repeat(MAX_CLIENT_MESSAGE_LENGTH - overhead))).ok).toBe(true);
  expect(parseClientMessage(frame("a".repeat(MAX_CLIENT_MESSAGE_LENGTH - overhead + 1)))).toEqual({
    ok: false,
    reason: "frame too large",
  });
  // lastVersions is gone from hello: subscriptions resume from their own version.
  expect(
    parseClientMessage(
      encode({
        type: "hello",
        protocol: 1,
        clientId: "c",
        lastVersions: {},
      } as unknown as ClientMessage),
    ).ok,
  ).toBe(false);
  expect(parseClientMessage(JSON.stringify({ type: "hello", protocol: 1 })).ok).toBe(false);
  // A resume sends version and epoch together.
  for (const extra of [{ version: 1 }, { epoch: "e" }]) {
    const frame = JSON.stringify({
      type: "subscribe",
      subId: "s0",
      query: "q",
      args: {},
      ...extra,
    });
    expect(parseClientMessage(frame)).toEqual({
      ok: false,
      reason: "version and epoch go together",
    });
  }
  expect(
    parseClientMessage(
      JSON.stringify({ type: "subscribe", subId: "x".repeat(65), query: "q", args: {} }),
    ).ok,
  ).toBe(false);
  // Unknown fields are refused, so nothing unexpected reaches a handler.
  expect(
    parseClientMessage(JSON.stringify({ type: "unsubscribe", subId: "s0", all: true })).ok,
  ).toBe(false);
});

test("the heartbeat frames are exact texts that parse both ways and take no other field", () => {
  // The shard's auto-response matches the exact text, so the client must send these bytes.
  expect(encode({ type: "ping" })).toBe(PING_FRAME);
  expect(encode({ type: "pong" })).toBe(PONG_FRAME);
  expect(parseClientMessage(PING_FRAME)).toEqual({ ok: true, message: { type: "ping" } });
  expect(parseServerMessage(PONG_FRAME)).toEqual({ ok: true, message: { type: "pong" } });
  expect(parseClientMessage('{"type":"ping","at":1}').ok).toBe(false);
  expect(parseServerMessage('{"type":"pong","at":1}').ok).toBe(false);
  // Each only travels one way.
  expect(parseServerMessage(PING_FRAME).ok).toBe(false);
  expect(parseClientMessage(PONG_FRAME).ok).toBe(false);
});
