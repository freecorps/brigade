// Which relay pages go through (RFC 0015 section 8), as `GET /health/paging` gives it to members for the dashboard's
// "Phones and pages": none, Freecorps' relay, or the company's own, with its host and app link.
import { generateInstanceKey } from "@freecorps/brigade-push/instance";
import { describe, expect, test, vi } from "vite-plus/test";
import { pagingHealthFor } from "../src/index.ts";
import { relaySetup, type RelayInstanceEnv } from "../src/relay-instance.ts";
import type { PagingHealth } from "../src/watchdog.ts";

const binding = { fetch: async () => new Response() } as unknown as RelayInstanceEnv["RELAY"];

describe("relaySetup", () => {
  test("no relay to reach, or no way to send through it, is none", async () => {
    const key = await generateInstanceKey();
    expect(await relaySetup({})).toEqual({ kind: "none" });
    // A key or a send token with nowhere to send.
    expect(await relaySetup({ RELAY_INSTANCE_KEY: key.privateKey })).toEqual({ kind: "none" });
    expect(await relaySetup({ RELAY_SEND_TOKEN: "t" })).toEqual({ kind: "none" });
    // A relay with neither a send token nor a key.
    expect(await relaySetup({ RELAY_URL: "https://relay.example.com" })).toEqual({ kind: "none" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // A key that does not read is no key.
      expect(
        await relaySetup({ RELAY_URL: "https://relay.example.com", RELAY_INSTANCE_KEY: "nope" }),
      ).toEqual({ kind: "none" });
    } finally {
      error.mockRestore();
    }
  });

  test("Freecorps' relay by default, through the send token alone (raw-token phones) or the instance key", async () => {
    const key = await generateInstanceKey();
    expect(
      await relaySetup({
        RELAY_URL: "https://relay.example.com/path",
        RELAY_INSTANCE_KEY: key.privateKey,
      }),
    ).toEqual({ kind: "freecorps", host: "relay.example.com", app: null });
    // Bound, with no address: no host to show.
    expect(await relaySetup({ RELAY: binding, RELAY_SEND_TOKEN: "t" })).toEqual({
      kind: "freecorps",
      host: null,
      app: null,
    });
    // An address that is not https is not shown.
    expect(
      await relaySetup({ RELAY_URL: "http://relay.example.com", RELAY_SEND_TOKEN: "t" }),
    ).toMatchObject({ kind: "freecorps", host: null });
  });

  test("own when the setup script marked it (RELAY_KIND) or it has an app link (RELAY_APP_URL)", async () => {
    const key = await generateInstanceKey();
    const base = {
      RELAY: binding,
      RELAY_URL: "https://relay.acme.example",
      RELAY_INSTANCE_KEY: key.privateKey,
    };
    expect(await relaySetup({ ...base, RELAY_KIND: "own" })).toEqual({
      kind: "own",
      host: "relay.acme.example",
      app: null,
    });
    expect(
      await relaySetup({ ...base, RELAY_APP_URL: "https://apps.example.com/acme-brigade" }),
    ).toEqual({
      kind: "own",
      host: "relay.acme.example",
      app: "https://apps.example.com/acme-brigade",
    });
    // A link with credentials is never shown, but still marks the relay as own.
    expect(
      await relaySetup({ ...base, RELAY_APP_URL: "https://user:secret@apps.example.com/x" }),
    ).toEqual({ kind: "own", host: "relay.acme.example", app: null });
    // Any other RELAY_KIND is Freecorps'.
    expect(await relaySetup({ ...base, RELAY_KIND: "freecorps" })).toMatchObject({
      kind: "freecorps",
    });
  });
});

describe("pagingHealthFor with the relay", () => {
  const health: PagingHealth = {
    status: "ok",
    reasons: [],
    lastBeatAt: null,
    lastProvedAt: null,
    lastOkAt: null,
    external: { configured: true, lastPingAt: null, lastPingOk: true },
  };
  const relay = { kind: "own", host: "relay.acme.example", app: null } as const;

  test("members get it; nobody else does", () => {
    expect(pagingHealthFor(health, ["responder"], relay)).toMatchObject({ relay });
    expect(pagingHealthFor(health, [], relay)).toEqual({ status: "ok" });
    expect(pagingHealthFor(health, ["owner"])).not.toHaveProperty("relay");
  });
});
