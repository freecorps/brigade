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
  PUSH_PLAINTEXT_MAX_BYTES,
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
import { receiveReceipt } from "../src/index.ts";
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
    const flipped = parts[7]!.startsWith("A") ? `B${parts[7]!.slice(1)}` : `A${parts[7]!.slice(1)}`;

    // v1.<key>.<workspace>.<incident>.<event>.<device>.<expiry>.<mac>
    expect(parts.slice(0, 2)).toEqual(["v1", "k1"]);
    const forged = [
      swap(7, flipped), // the MAC altered
      swap(7, toBase64url(random(32))), // a made-up MAC
      swap(5, newId("dev", Date.now(), random)), // another device
      swap(4, newId("evt", Date.now(), random)), // another page
      swap(6, String(Number(parts[6]) + 3600)), // a later expiry
      swap(2, other.id), // another workspace
      swap(1, "k2"), // a key this shard does not hold
      parts.filter((_, i) => i !== 1).join("."), // no key id
    ];
    for (const bad of forged) expect((await receipt(bad)).status, bad).toBe(403);
    // A token another workspace's shard minted for this page is not this shard's either.
    const theirs = (await other.mint(incident, event.id, [phone.deviceId])).get(phone.deviceId)!;
    expect((await receipt(swap(7, theirs.split(".")[7]!))).status).toBe(403);
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
      "k1",
      ghost,
      newId("inc", Date.now(), random),
      newId("evt", Date.now(), random),
      newId("dev", Date.now(), random),
      "9999999999",
      toBase64url(random(32)),
    ].join(".");
    expect((await receipt(made)).status).toBe(403);
  });

  test("a body streamed without a length is read only up to its limit", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode(" ".repeat(512));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Far more than the limit if it were all read: the Worker must stop after about 1 KiB.
        if (++pulled > 64) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const response = await receiveReceipt(
      new Request("http://api.test/receipts", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
      env,
    );
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(8);
  });
});

describe("the Worker's rate limit", () => {
  /** The Worker's env with a stand-in limiter and a shard namespace that records every wake. */
  function limited(success: boolean | (() => never)) {
    const keys: string[] = [];
    const woken: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        if (typeof success === "function") success();
        return { success: success as boolean };
      },
    };
    const namespace = new Proxy(env.WORKSPACE, {
      get(target, property) {
        if (property !== "getByName") return Reflect.get(target, property);
        return (name: string) => {
          woken.push(name);
          return target.getByName(name);
        };
      },
    });
    const limitedEnv = { ...env, RECEIPT_LIMIT: limiter, WORKSPACE: namespace } as unknown as Env;
    return { keys, woken, env: limitedEnv };
  }

  test("refuses before waking the shard, keyed on the workspace and the caller", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deliver(event, relay().send);
    const token = (await ws.mint(incident, event.id, [phone.deviceId])).get(phone.deviceId)!;
    const request = () =>
      new Request("http://api.test/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "caller-1" },
        body: JSON.stringify({ token }),
      });

    const refused = limited(false);
    const response = await receiveReceipt(request(), refused.env);
    expect(response.status).toBe(429);
    expect(refused.keys).toEqual([`${ws.id}:caller-1`]);
    expect(refused.woken).toEqual([]);
    expect(
      (await ws.delivery(deliveryId(incident, event.id, phone.deviceId)))?.deliveredAt,
    ).toBeNull();

    // Under the limit the receipt goes through; a limiter that fails lets it through too.
    const allowed = limited(true);
    expect((await receiveReceipt(request(), allowed.env)).status).toBe(200);
    expect(allowed.woken).toEqual([ws.id]);
    const broken = limited(() => {
      throw new Error("limiter down");
    });
    expect((await receiveReceipt(request(), broken.env)).status).toBe(200);
    expect(logged().some((line) => line.message === "receipt rate limit failed")).toBe(true);
  });

  test("a token for a made-up workspace never reaches the limiter or a shard", async () => {
    const check = limited(true);
    const ghost = [
      "v1",
      "k1",
      newId("ws", Date.now(), random),
      newId("inc", Date.now(), random),
      newId("evt", Date.now(), random),
      newId("dev", Date.now(), random),
      "9999999999",
      toBase64url(random(32)),
    ].join(".");
    const response = await receiveReceipt(
      new Request("http://api.test/receipts", {
        method: "POST",
        body: JSON.stringify({ token: ghost }),
      }),
      check.env,
    );
    expect(response.status).toBe(403);
    expect(check.keys).toEqual([]);
    expect(check.woken).toEqual([]);
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

  test("a page too big to carry its receipt is sealed again without it, and still accepted", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    // Longer than a title can be today, as a later field or limit could make a page: the content alone fits the
    // 2048 bytes a page may seal, the content and its receipt do not.
    const title = "x".repeat(1900);
    await ws.withShard((shard) => shard.store.update("incidents", incident, { title }));
    const { envelopes, send } = relay();
    const result = await deliver(event, send);

    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(envelopes).toHaveLength(1);
    const page = await openPush(phone.recipient, parsePushEnvelope(envelopes[0])!);
    expect(page.body).toBe(title);
    expect(page.receipt).toBeUndefined();
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    const token = (await ws.mint(incident, event.id, [phone.deviceId])).get(phone.deviceId)!;
    expect(bytes(page)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
    expect(
      bytes({ ...page, receipt: { url: `${DASHBOARD}/api/receipts`, token } }),
    ).toBeGreaterThan(PUSH_PLAINTEXT_MAX_BYTES);
    expect(await ws.delivery(deliveryId(incident, event.id, phone.deviceId))).toMatchObject({
      acceptedAt: expect.any(Number),
      error: null,
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
