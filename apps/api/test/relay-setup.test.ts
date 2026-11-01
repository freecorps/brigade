// Which relay pages go through (RFC 0015 section 8), as `GET /health/paging` gives it to members for the dashboard's
// "Phones and pages": none, Freecorps' relay, or the company's own, with its host and app link.
import { generateInstanceKey } from "@freecorps/brigade-push/instance";
import { describe, expect, test } from "vite-plus/test";
import { pagingHealthFor } from "../src/index.ts";
import { relaySetup, type RelayInstanceEnv } from "../src/relay-instance.ts";
import type { PagingHealth } from "../src/watchdog.ts";

const binding = { fetch: async () => new Response() } as unknown as RelayInstanceEnv["RELAY"];

describe("relaySetup", () => {
  test("no relay to reach, or no way to send through it, is none", async () => {
    const key = await generateInstanceKey();
    expect(relaySetup({})).toEqual({ kind: "none" });
    // A key or a send token with nowhere to send.
    expect(relaySetup({ RELAY_INSTANCE_KEY: key.privateKey })).toEqual({ kind: "none" });
    expect(relaySetup({ RELAY_SEND_TOKEN: "t" })).toEqual({ kind: "none" });
    // A relay with neither a send token nor a key (blank ones are none either).
    expect(relaySetup({ RELAY_URL: "https://relay.example.com" })).toEqual({ kind: "none" });
    expect(
      relaySetup({
        RELAY_URL: "https://relay.example.com",
        RELAY_SEND_TOKEN: " ",
        RELAY_INSTANCE_KEY: "",
      }),
    ).toEqual({ kind: "none" });
  });

  test("a key that does not read is still a relay: the watchdog says bad signature, not 'set one up'", () => {
    // "No relay, run setup:relay" would make a new key and orphan every handle phones hold.
    expect(
      relaySetup({ RELAY_URL: "https://relay.example.com", RELAY_INSTANCE_KEY: "nope" }),
    ).toEqual({ kind: "freecorps" });
    expect(
      relaySetup({
        RELAY_URL: "https://relay.acme.example",
        RELAY_INSTANCE_KEY: "nope",
        RELAY_KIND: "own",
      }),
    ).toEqual({ kind: "own", host: "relay.acme.example", app: null });
  });

  test("Freecorps' relay by default, through the send token alone (raw-token phones) or the key; no host", async () => {
    const key = await generateInstanceKey();
    expect(
      relaySetup({
        RELAY_URL: "https://relay.example.com/path",
        RELAY_INSTANCE_KEY: key.privateKey,
      }),
    ).toEqual({ kind: "freecorps" });
    expect(relaySetup({ RELAY: binding, RELAY_SEND_TOKEN: "t" })).toEqual({ kind: "freecorps" });
  });

  test("own when the setup script marked it (RELAY_KIND, any value) or it has an app link (RELAY_APP_URL)", async () => {
    const key = await generateInstanceKey();
    const base = {
      RELAY: binding,
      RELAY_URL: "https://relay.acme.example",
      RELAY_INSTANCE_KEY: key.privateKey,
    };
    expect(relaySetup({ ...base, RELAY_KIND: "own" })).toEqual({
      kind: "own",
      host: "relay.acme.example",
      app: null,
    });
    expect(relaySetup({ ...base, RELAY_APP_URL: "https://apps.example.com/acme-brigade" })).toEqual(
      { kind: "own", host: "relay.acme.example", app: "https://apps.example.com/acme-brigade" },
    );
    // A link with credentials is never shown, but still marks the relay as own.
    expect(
      relaySetup({ ...base, RELAY_APP_URL: "https://user:secret@apps.example.com/x" }),
    ).toEqual({ kind: "own", host: "relay.acme.example", app: null });
    // The script reads only secret names, so any RELAY_KIND is own there; the API agrees, so the two never differ.
    expect(relaySetup({ ...base, RELAY_KIND: "freecorps" })).toMatchObject({ kind: "own" });
    expect(relaySetup({ ...base, RELAY_KIND: " " })).toEqual({ kind: "freecorps" });
    // Bound, with no address, or an address that is not https: no host to show.
    expect(relaySetup({ RELAY: binding, RELAY_SEND_TOKEN: "t", RELAY_KIND: "own" })).toEqual({
      kind: "own",
      host: null,
      app: null,
    });
    expect(
      relaySetup({
        RELAY_URL: "http://relay.acme.example",
        RELAY_SEND_TOKEN: "t",
        RELAY_KIND: "own",
      }),
    ).toMatchObject({ kind: "own", host: null });
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
