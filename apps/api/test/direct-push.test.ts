// Sending without the relay (RFC 0016 "Push", step 2): an instance with the app's own APNs key and Firebase service
// account pages from its own Worker through the relay's code and Ember's push transport, and the relay is the
// fallback for whatever goes wrong on the instance's side.
import { env } from "cloudflare:workers";
import { createExecutionContext, createMessageBatch, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  generateRecipient,
  openPush,
  parsePushEnvelope,
  toBase64url,
} from "@freecorps/brigade-push";
import { newId, type Actor, type Role } from "@freecorps/brigade-schema";
import { DIRECT_BUDGET_MS, directSettles } from "../src/direct-push.ts";
import { consumeEvents, type Fetch, type NotifyEnv } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const user = (id: string, role: Role): Actor => ({ kind: "user", id, role });
const ana = user("usr_ana", "owner");
const bia = user("usr_bia", "responder");

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A throwaway APNs token key (`.p8`-shaped PEM), never a real one. */
async function apnsKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const der = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  const b64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

let logged: () => Record<string, unknown>[];
beforeEach(() => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  logged = () =>
    spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

let mutations = 0;

/** A workspace with Ana and Bia, Bia's iPhone registered with a hex APNs token, and a SEV1 Ana declared. */
async function paged(platform: "ios" | "android" = "ios", criticalAlerts?: boolean) {
  const id = newId("ws", Date.now(), random);
  const stub = env.WORKSPACE.getByName(id);
  expect(await stub.provision({ id, name: "Acme" }, ana)).toEqual({ ok: true });
  const withShard = <R>(fn: (shard: Shard, sql: SqlStorage) => R) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state.storage.sql,
      ),
    );
  const run = (actor: Actor, name: string, args: object) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: `d${++mutations}`,
        actor,
        name,
        args,
        now: Date.now(),
        internal: true,
      });
      expect(result, name).toMatchObject({ ok: true });
    });
  for (const member of [ana, bia]) {
    await run(member, "member.sync", { id: member.id, name: member.id, role: member.role });
  }
  const recipient = await generateRecipient();
  const deviceId = newId("dev", Date.now(), random);
  const pushToken = platform === "ios" ? hex(random(32)) : `fcm_${hex(random(40))}`;
  await run(bia, "device.register", {
    id: deviceId,
    platform,
    environment: platform === "ios" ? "sandbox" : "production",
    pushToken,
    voipToken: null,
    publicKey: toBase64url(recipient.publicKey),
    ...(criticalAlerts === undefined ? {} : { criticalAlerts }),
  });
  const incident = newId("inc", Date.now(), random);
  await run(ana, "incident.declare", { id: incident, title: "Checkout is down", severity: "sev1" });
  const event = await withShard((_shard, sql) =>
    sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent)
      .find((e) => e.type === "incident.declared" && e.subject === incident),
  );
  const deliveries = () =>
    withShard((shard) =>
      shard.store.scan("deliveries").filter((row) => row.incidentId === incident),
    );
  const devices = () => withShard((shard) => shard.store.scan("devices").map((row) => row.id));
  return { event: event!, recipient, deviceId, pushToken, deliveries, devices };
}

/**
 * APNs and the relay, faked: `apns(request)` answers what the instance sends to Apple, `relay(body)` what it posts to
 * the relay. Records both.
 */
function providers(
  apns: (request: Request) => Response | Promise<Response> = () => new Response(null),
  relay: (body: Record<string, unknown>) => Response = () => Response.json({ status: 200 }),
) {
  const toApns: Request[] = [];
  const toRelay: Record<string, unknown>[] = [];
  const send: Fetch = async (request) => {
    const host = new URL(request.url).hostname;
    if (host.endsWith("push.apple.com")) {
      toApns.push(request.clone());
      return apns(request);
    }
    if (host === "relay.test") {
      const body = (await request.json()) as Record<string, unknown>;
      toRelay.push(body);
      return relay(body);
    }
    throw new Error(`unexpected request to ${host}`);
  };
  return { send, toApns, toRelay };
}

let key: string;
const directEnv = (overrides: Partial<NotifyEnv> = {}) =>
  ({
    WORKSPACE: env.WORKSPACE,
    RELAY_URL: "https://relay.test",
    RELAY_SEND_TOKEN: "test-token",
    APNS_KEY: key,
    APNS_KEY_ID: "KEYID12345",
    APNS_TEAM_ID: "TEAMID1234",
    APNS_TOPIC: "app.freecorps.brigade",
    ...overrides,
  }) as NotifyEnv;

async function consume(event: BrigadeEvent, environment: NotifyEnv, send: Fetch) {
  const batch = createMessageBatch("brigade-events", [
    { id: "msg-0", timestamp: new Date(), attempts: 1, body: event },
  ]);
  createExecutionContext();
  await consumeEvents(batch, environment, send);
}

beforeEach(async () => {
  key ??= await apnsKey();
});

describe("direct sends", () => {
  test("a page goes to APNs from the instance with the envelope the phone opens, and never to the relay", async () => {
    const page = await paged();
    const fake = providers();
    await consume(page.event, directEnv(), fake.send);
    expect(fake.toRelay).toHaveLength(0);
    expect(fake.toApns).toHaveLength(1);
    const request = fake.toApns[0]!;
    expect(request.url).toBe(`https://api.sandbox.push.apple.com/3/device/${page.pushToken}`);
    expect(request.headers.get("apns-topic")).toBe("app.freecorps.brigade");
    expect(request.headers.get("apns-push-type")).toBe("alert");
    expect(request.headers.get("authorization")).toMatch(/^bearer ey/);
    const payload = (await request.json()) as {
      aps: Record<string, unknown>;
      brigade: unknown;
    };
    expect(payload.aps).toMatchObject({
      "mutable-content": 1,
      "interruption-level": "time-sensitive",
    });
    const content = await openPush(page.recipient, parsePushEnvelope(payload.brigade)!);
    expect(content).toMatchObject({ body: "Checkout is down", incident: page.event.subject });
    const [row] = await page.deliveries();
    expect(row).toMatchObject({ deviceId: page.deviceId, error: null });
    expect(row!.acceptedAt).not.toBeNull();
  });

  test("APNs refusing the instance's key pages through the relay with the same envelope", async () => {
    const page = await paged();
    const fake = providers(() =>
      Response.json({ reason: "InvalidProviderToken" }, { status: 403 }),
    );
    await consume(page.event, directEnv(), fake.send);
    // Ember's token, then the relay code's own signer, both refused; then the relay.
    expect(fake.toApns).toHaveLength(2);
    expect(fake.toRelay).toHaveLength(1);
    expect(fake.toRelay[0]).toMatchObject({ deviceToken: page.pushToken, environment: "sandbox" });
    const sentEnvelope = ((await fake.toApns[0]!.json()) as { brigade: unknown }).brigade;
    expect(fake.toRelay[0]!.envelope).toEqual(sentEnvelope);
    expect((await page.deliveries())[0]!.acceptedAt).not.toBeNull();
    expect(logged()).toContainEqual(
      expect.objectContaining({
        message: "direct send failed, paging the device through the relay",
        reason: "InvalidProviderToken",
      }),
    );
  });

  test("APNs out of reach, or a topic that is not the app's, pages through the relay and drops no phone", async () => {
    for (const apns of [
      () => Promise.reject(new Error("Network connection lost.")),
      () => Response.json({ reason: "DeviceTokenNotForTopic" }, { status: 400 }),
    ]) {
      const page = await paged();
      const fake = providers(apns);
      await consume(page.event, directEnv(), fake.send);
      expect(fake.toRelay).toHaveLength(1);
      expect((await page.deliveries())[0]!.acceptedAt).not.toBeNull();
      expect(await page.devices()).toContain(page.deviceId);
    }
  });

  test("a token APNs says is gone is settled by the direct send: the device is dropped, the relay not asked", async () => {
    const page = await paged();
    const fake = providers(() => Response.json({ reason: "BadDeviceToken" }, { status: 400 }));
    await consume(page.event, directEnv(), fake.send);
    expect(fake.toRelay).toHaveLength(0);
    expect(await page.devices()).not.toContain(page.deviceId);
    expect((await page.deliveries())[0]).toMatchObject({ error: "token_invalid" });
  });

  test("an Android phone without the instance's Firebase service account goes through the relay", async () => {
    const page = await paged("android");
    const fake = providers();
    await consume(page.event, directEnv(), fake.send);
    expect(fake.toApns).toHaveLength(0);
    expect(fake.toRelay).toHaveLength(1);
    expect(fake.toRelay[0]).toMatchObject({ platform: "android", deviceToken: page.pushToken });
  });

  test("without all four APNs secrets nothing goes direct: the relay pages as before", async () => {
    const page = await paged();
    const fake = providers();
    await consume(page.event, directEnv({ APNS_TOPIC: "" }), fake.send);
    expect(fake.toApns).toHaveLength(0);
    expect(fake.toRelay).toHaveLength(1);
  });

  test("an instance with no relay at all still pages directly, and a failure is retried like a relay's", async () => {
    const page = await paged();
    const fake = providers(() => new Response("busy", { status: 503 }));
    await consume(
      page.event,
      directEnv({ RELAY_URL: undefined, RELAY_SEND_TOKEN: undefined }),
      fake.send,
    );
    expect(fake.toRelay).toHaveLength(0);
    expect(fake.toApns.length).toBeGreaterThan(0);
    expect((await page.deliveries())[0]).toMatchObject({ acceptedAt: null });
    expect((await page.deliveries())[0]!.error).not.toBeNull();
  });
});

describe("direct sends without a relay behind them", () => {
  const alone = () => directEnv({ RELAY_URL: undefined, RELAY_SEND_TOKEN: undefined });

  test("a topic APNs refuses is this instance's mistake: the phone is kept, the page fails visibly", async () => {
    const page = await paged();
    const fake = providers(() =>
      Response.json({ reason: "DeviceTokenNotForTopic" }, { status: 400 }),
    );
    await consume(page.event, alone(), fake.send);
    expect(await page.devices()).toContain(page.deviceId);
    expect((await page.deliveries())[0]).toMatchObject({
      acceptedAt: null,
      error: "apns_refused",
    });
  });

  test("a token APNs says is gone is still dropped", async () => {
    const page = await paged();
    const fake = providers(() => Response.json({ reason: "Unregistered" }, { status: 410 }));
    await consume(page.event, alone(), fake.send);
    expect(await page.devices()).not.toContain(page.deviceId);
  });
});

describe("the direct route keeps the notifier's own rules", () => {
  test("a SEV1 to an iPhone that allows Critical Alerts rings on silent, sent directly", async () => {
    const page = await paged("ios", true);
    const fake = providers();
    await consume(page.event, directEnv(), fake.send);
    expect(fake.toRelay).toHaveLength(0);
    const payload = (await fake.toApns[0]!.json()) as { aps: Record<string, unknown> };
    expect(payload.aps).toMatchObject({
      "interruption-level": "critical",
      sound: { critical: 1, name: "default", volume: 1 },
    });
  });

  test("APNs that never answers hands the page to the relay within the direct budget", async () => {
    const page = await paged();
    const fake = providers(() => new Promise<Response>(() => {}));
    const started = Date.now();
    await consume(page.event, directEnv(), fake.send);
    expect(Date.now() - started).toBeLessThan(DIRECT_BUDGET_MS + 2000);
    expect(fake.toRelay).toHaveLength(1);
    expect((await page.deliveries())[0]!.acceptedAt).not.toBeNull();
  }, 20_000);
});

describe("which direct answers settle a send", () => {
  test("delivered, or the device's token is gone; never a topic, a sender or a key", () => {
    expect(directSettles(200, {})).toBe(true);
    expect(directSettles(502, { status: 410, reason: "Unregistered" })).toBe(true);
    expect(directSettles(502, { status: 400, reason: "BadDeviceToken" })).toBe(true);
    expect(directSettles(502, { status: 404, reason: "UNREGISTERED", tokenInvalid: true })).toBe(
      true,
    );
    expect(directSettles(502, { status: 400, reason: "DeviceTokenNotForTopic" })).toBe(false);
    expect(
      directSettles(502, { status: 403, reason: "SENDER_ID_MISMATCH", tokenInvalid: true }),
    ).toBe(false);
    expect(directSettles(502, { status: 403, reason: "InvalidProviderToken" })).toBe(false);
    expect(directSettles(502, { error: "apns_unreachable" })).toBe(false);
    expect(directSettles(500, { error: "relay_misconfigured" })).toBe(false);
    expect(directSettles(400, { error: "invalid_body" })).toBe(false);
  });
});
