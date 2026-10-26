// Delivery receipts (RFC 0006 "Delivery receipts"): each page carries a sealed token per device, the phone posts it
// back to `POST /receipts`, and the shard records the delivered stage once. Tokens cannot be forged, altered, used
// for another page, device or workspace, replayed into a second record, or used after they expire; and nothing about
// receipts can stop a page.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  generateRecipient,
  openPush,
  parsePushEnvelope,
  toBase64url,
  type HpkeRecipient,
} from "@freecorps/brigade-push";
import {
  deliveryId,
  newId,
  type Actor,
  type DeliveryRow,
  type Role,
} from "@freecorps/brigade-schema";
import { consumeEvents, receiptUrl, type Fetch } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import {
  parseReceiptToken,
  RECEIPT_RATE_PER_MINUTE,
  RECEIPT_TTL_MS,
  Receipts,
} from "../src/receipts.ts";
import { Shard } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const user = (id: string, role: Role): Actor => ({ kind: "user", id, role });
const ana = user("usr_ana", "owner");
const bia = user("usr_bia", "responder");

let logged: () => Record<string, unknown>[];
beforeEach(() => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  logged = () =>
    spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
});
afterEach(() => {
  vi.restoreAllMocks();
});

let names = 0;
let mutations = 0;

/** A workspace in D1 and its shard, with Ana and Bia. */
async function workspace() {
  const id = newId("ws", Date.now() + ++names, random);
  await env.DB.prepare(
    'insert into "organization" ("id", "name", "slug", "createdAt") values (?, ?, ?, ?)',
  )
    .bind(id, "Acme", `ws-${id}`, new Date().toISOString())
    .run();
  const stub = env.WORKSPACE.getByName(id);
  expect(await stub.provision({ id, name: "Acme" }, ana)).toEqual({ ok: true });
  const withShard = <R>(
    fn: (shard: Shard, state: DurableObjectState, instance: WorkspaceDO) => R | Promise<R>,
  ) =>
    runInDurableObject(stub, (instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state,
        instance,
      ),
    );
  const run = (actor: Actor, name: string, args: object) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: `m${++mutations}`,
        actor,
        name,
        args,
        now: Date.now(),
        internal: true,
      });
      expect(result, name).toMatchObject({ ok: true });
    });
  for (const member of [ana, bia]) {
    await run(member, "member.sync", {
      id: member.id,
      name: member.id.slice(4),
      role: member.role,
    });
  }
  const device = async (actor: Actor) => {
    const recipient = await generateRecipient();
    const deviceId = newId("dev", Date.now(), random);
    await run(actor, "device.register", {
      id: deviceId,
      platform: "ios",
      environment: "production",
      pushToken: toBase64url(random(32)).replace(/[-_]/g, "a"),
      voipToken: null,
      publicKey: toBase64url(recipient.publicKey),
    });
    return { deviceId, recipient };
  };
  const declare = async (actor: Actor) => {
    const incident = newId("inc", Date.now(), random);
    await run(actor, "incident.declare", {
      id: incident,
      title: "Checkout is down",
      severity: "sev1",
    });
    const event = (await events()).find(
      (e) => e.type === "incident.declared" && e.subject === incident,
    )!;
    return { incident, event };
  };
  const events = () =>
    withShard((_shard, state) =>
      state.storage.sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => JSON.parse(row.event) as BrigadeEvent),
    );
  const delivery = (id: string) =>
    withShard((shard) => shard.store.get("deliveries", id) as DeliveryRow | undefined);
  /** Mints tokens with this shard's own key, as `planPage` does, at `now`. */
  const mint = (incidentId: string, eventId: string, deviceIds: string[], now = Date.now()) =>
    withShard((shard, state) =>
      new Receipts({
        storage: state.storage,
        shard,
        randomBytes: random,
        log: () => {},
        committed: () => {},
      }).mint({ workspaceId: id, incidentId, eventId }, deviceIds, now),
    );
  return { id, stub, withShard, run, device, declare, events, delivery, mint };
}

const DASHBOARD = "https://brigade.example";
const notifyEnv = () =>
  ({
    WORKSPACE: env.WORKSPACE,
    RELAY_URL: "https://relay.test",
    RELAY_SEND_TOKEN: "test-token",
    DASHBOARD_URL: DASHBOARD,
  }) as Parameters<typeof consumeEvents>[1];

/** A relay that answers `answer` and keeps every envelope it got. */
function relay(answer: () => Response | Promise<Response> = () => Response.json({ status: 200 })) {
  const envelopes: unknown[] = [];
  const send: Fetch = async (request) => {
    envelopes.push(((await request.json()) as { envelope: unknown }).envelope);
    return answer();
  };
  return { envelopes, send };
}

async function deliver(event: BrigadeEvent, send: Fetch, environment = notifyEnv()) {
  const batch = createMessageBatch("brigade-events", [
    { id: "msg-0", timestamp: new Date(), attempts: 1, body: event },
  ]);
  const ctx = createExecutionContext();
  await consumeEvents(batch, environment, send);
  return getQueueResult(batch, ctx);
}

async function receipt(token: unknown, init: RequestInit = {}) {
  return exports.default.fetch("http://api.test/receipts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    ...init,
  });
}

/** Opens what the relay got for one device and returns its sealed receipt. */
async function sealedReceipt(envelope: unknown, recipient: HpkeRecipient) {
  const content = await openPush(recipient, parsePushEnvelope(envelope)!);
  return content.receipt;
}

describe("a page's receipt", () => {
  test("is sealed per device, and the phone's receipt records the delivered stage once", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const { envelopes, send } = relay();
    await deliver(event, send);

    expect(envelopes).toHaveLength(1);
    // The relay sees only ciphertext: the token is inside.
    expect(JSON.stringify(envelopes)).not.toContain("v1.");
    const page = await openPush(phone.recipient, parsePushEnvelope(envelopes[0])!);
    // The receipt rides with the ids the Acknowledge action needs (RFC 0004 "Clients").
    expect(page).toMatchObject({ incident, workspace: ws.id });
    const sealed = page.receipt;
    expect(sealed?.url).toBe(`${DASHBOARD}/api/receipts`);
    expect(parseReceiptToken(sealed?.token)?.claim).toMatchObject({
      workspaceId: ws.id,
      incidentId: incident,
      eventId: event.id,
      deviceId: phone.deviceId,
    });

    const id = deliveryId(incident, event.id, phone.deviceId);
    expect(await ws.delivery(id)).toMatchObject({
      userId: bia.id,
      attempts: 1,
      error: null,
      acceptedAt: expect.any(Number),
      deliveredAt: null,
    });

    const first = await receipt(sealed!.token);
    expect(first.status).toBe(200);
    const deliveredAt = (await ws.delivery(id))?.deliveredAt;
    expect(deliveredAt).toEqual(expect.any(Number));

    // A replay (the extension ran twice, or someone resent it) is fine and changes nothing.
    const again = await receipt(sealed!.token);
    expect(again.status).toBe(200);
    expect((await ws.delivery(id))?.deliveredAt).toBe(deliveredAt);
    const delivered = (await ws.events()).filter((e) => e.type === "notification.delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.data).toEqual({
      incidentId: incident,
      eventId: event.id,
      userId: bia.id,
      deviceId: phone.deviceId,
    });
  });

  test("refuses forged or altered tokens, and another page's, device's or workspace's", async () => {
    const ws = await workspace();
    const other = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const { envelopes, send } = relay();
    await deliver(event, send);
    const token = (await sealedReceipt(envelopes[0], phone.recipient))!.token;
    const parts = token.split(".");
    const swap = (index: number, value: string) =>
      parts.map((part, i) => (i === index ? value : part)).join(".");
    const flipped = parts[6]!.startsWith("A") ? `B${parts[6]!.slice(1)}` : `A${parts[6]!.slice(1)}`;

    const forged = [
      swap(6, flipped), // the MAC altered
      swap(6, toBase64url(random(32))), // a made-up MAC
      swap(4, newId("dev", Date.now(), random)), // another device
      swap(3, newId("evt", Date.now(), random)), // another page
      swap(5, String(Number(parts[5]) + 3600)), // a later expiry
      swap(1, other.id), // another workspace
    ];
    for (const bad of forged) expect((await receipt(bad)).status, bad).toBe(403);
    // A token another workspace's shard minted for this page is not this shard's either.
    const theirs = (await other.mint(incident, event.id, [phone.deviceId])).get(phone.deviceId)!;
    expect((await receipt(swap(6, theirs.split(".")[6]!))).status).toBe(403);
    expect(
      (await ws.delivery(deliveryId(incident, event.id, phone.deviceId)))?.deliveredAt,
    ).toBeNull();
  });

  test("a genuine token for a page never planned for that device is not found", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident } = await ws.declare(ana);
    const unplanned = newId("evt", Date.now(), random);
    const token = (await ws.mint(incident, unplanned, [phone.deviceId])).get(phone.deviceId)!;
    expect((await receipt(token)).status).toBe(404);
  });

  test("expires", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deliver(event, relay().send);
    const old = Date.now() - RECEIPT_TTL_MS - 2000;
    const token = (await ws.mint(incident, event.id, [phone.deviceId], old)).get(phone.deviceId)!;
    expect((await receipt(token)).status).toBe(410);
    expect(
      (await ws.delivery(deliveryId(incident, event.id, phone.deviceId)))?.deliveredAt,
    ).toBeNull();
  });

  test(`at most ${RECEIPT_RATE_PER_MINUTE} receipts a minute from one device`, async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident } = await ws.declare(ana);
    const pages = Array.from({ length: RECEIPT_RATE_PER_MINUTE + 1 }, () =>
      newId("evt", Date.now(), random),
    );
    const statuses: number[] = [];
    for (const page of pages) {
      const token = (await ws.mint(incident, page, [phone.deviceId])).get(phone.deviceId)!;
      statuses.push((await receipt(token)).status);
    }
    // Inside one minute window: the last one is over (the window can roll over mid-test, which only allows more).
    expect(statuses.filter((status) => status === 429).length).toBeLessThanOrEqual(1);
    expect(statuses.slice(0, RECEIPT_RATE_PER_MINUTE).every((status) => status === 404)).toBe(true);
  });

  test("the route takes only a small JSON POST naming a workspace that exists", async () => {
    expect((await exports.default.fetch("http://api.test/receipts")).status).toBe(405);
    expect((await receipt(undefined, { body: "not json" })).status).toBe(400);
    expect((await receipt("x".repeat(2000))).status).toBe(413);
    expect((await receipt("v1.nope")).status).toBe(403);
    const ghost = newId("ws", Date.now(), random);
    const made = [
      "v1",
      ghost,
      newId("inc", Date.now(), random),
      newId("evt", Date.now(), random),
      newId("dev", Date.now(), random),
      "9999999999",
      toBase64url(random(32)),
    ].join(".");
    expect((await receipt(made)).status).toBe(403);
  });
});

describe("receipts never stop a page", () => {
  test("a shard that cannot mint tokens still pages, without a receipt", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    // A key the runtime refuses to import: minting throws.
    await ws.withShard((_shard, state) =>
      state.storage.sql.exec("insert into receipt_key (id, key) values (1, x'')"),
    );
    const { incident, event } = await ws.declare(ana);
    const { envelopes, send } = relay();
    const result = await deliver(event, send);
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(envelopes).toHaveLength(1);
    expect(await sealedReceipt(envelopes[0], phone.recipient)).toBeUndefined();
    expect(logged().some((line) => line.message === "minting receipt tokens failed")).toBe(true);
    expect(await ws.delivery(deliveryId(incident, event.id, phone.deviceId))).toMatchObject({
      acceptedAt: expect.any(Number),
    });
  });

  test("without a dashboard URL pages go out without a receipt", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { event } = await ws.declare(ana);
    const { envelopes, send } = relay();
    await deliver(event, send, { ...notifyEnv(), DASHBOARD_URL: undefined });
    expect(envelopes).toHaveLength(1);
    expect(await sealedReceipt(envelopes[0], phone.recipient)).toBeUndefined();
    expect(receiptUrl("javascript:alert(1)")).toBeUndefined();
    expect(receiptUrl("https://brigade.example/some/path")).toBe(`${DASHBOARD}/api/receipts`);
  });
});

describe("each device's stage says what the relay answered", () => {
  test.each([
    [
      "APNs says the token is gone",
      () => Response.json({ status: 400, reason: "BadDeviceToken" }, { status: 502 }),
      { error: "token_invalid", reason: "BadDeviceToken" },
    ],
    [
      "APNs refuses for another reason",
      () => Response.json({ status: 400, reason: "PayloadTooLarge" }, { status: 502 }),
      { error: "apns_refused", reason: "PayloadTooLarge" },
    ],
    [
      "APNs is throttling",
      () => Response.json({ status: 429, reason: "TooManyRequests" }, { status: 502 }),
      { error: "apns_unavailable", reason: "TooManyRequests" },
    ],
    [
      "the relay refuses the request",
      () => Response.json({ error: "unauthorized" }, { status: 401 }),
      { error: "relay_refused", reason: null },
    ],
    [
      "the relay cannot be reached",
      () => Promise.reject(new Error("connection refused")),
      { error: "relay_unreachable", reason: null },
    ],
  ])("%s", async (_name, answer, expected) => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deliver(event, relay(answer).send);
    expect(await ws.delivery(deliveryId(incident, event.id, phone.deviceId))).toMatchObject({
      sentAt: expect.any(Number),
      acceptedAt: null,
      attempts: 1,
      ...expected,
    });
  });

  test("no relay configured", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deliver(event, relay().send, { WORKSPACE: env.WORKSPACE } as Parameters<
      typeof consumeEvents
    >[1]);
    expect(await ws.delivery(deliveryId(incident, event.id, phone.deviceId))).toMatchObject({
      error: "not_configured",
      acceptedAt: null,
    });
  });
});
