// Escalation in the shard and the notifier (RFC 0006 "Who is paged"): a default policy pages whoever is on call
// instead of the interim rule, the shard's alarm fires each next level, an ack stops it, and every fallback of the
// paging path: unreachable levels escalate at once, no level left falls back to the interim rule, a restart
// resumes from stored state, redeliveries page nobody twice, and a dead-lettered level is recorded.
import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { toBase64url, generateRecipient } from "@freecorps/brigade-push";
import {
  MONITOR_ACTOR,
  newId,
  type Actor,
  type Role,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import { consumeDeadLetters, consumeEvents, type Fetch } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { WorkspaceDO } from "../src/workspace.ts";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const user = (id: string, role: Role): Actor => ({ kind: "user", id, role });
const ana = user("usr_ana", "owner");
const bia = user("usr_bia", "admin");
const caio = user("usr_caio", "responder");
const eva = user("usr_eva", "responder");
const duda = user("usr_duda", "viewer");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

let names = 0;
let mutations = 0;

/** A provisioned workspace whose members are synced, with helpers to run mutations and read what they wrote. */
async function workspace() {
  const id = newId("ws", Date.now() + ++names, random);
  const stub = env.WORKSPACE.getByName(id);
  expect(await stub.provision({ id, name: "Acme" }, ana)).toEqual({ ok: true });
  const withShard = <R>(
    fn: (shard: Shard, state: DurableObjectState, instance: WorkspaceDO) => R,
  ) =>
    runInDurableObject(stub, (instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state,
        instance,
      ),
    );
  const run = (actor: Actor, name: string, args: object, internal = true) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: `m${++mutations}`,
        actor,
        name,
        args,
        now: Date.now(),
        internal,
      });
      expect(result, name).toMatchObject({ ok: true });
      return result;
    });
  for (const member of [ana, bia, caio, eva, duda]) {
    await run(member, "member.sync", {
      id: member.id,
      name: member.id.slice(4),
      role: member.role,
    });
  }
  const device = async (actor: Actor) => {
    const recipient = await generateRecipient();
    await run(actor, "device.register", {
      id: newId("dev", Date.now(), random),
      platform: "ios",
      environment: "sandbox",
      pushToken: toBase64url(random(32)).replace(/[-_]/g, "a"),
      voipToken: null,
      publicKey: toBase64url(recipient.publicKey),
    });
  };
  const events = (subject?: string) =>
    withShard((_shard, state) =>
      state.storage.sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => JSON.parse(row.event) as BrigadeEvent)
        .filter((event) => subject === undefined || event.subject === subject),
    );
  const declare = async (actor: Actor, severity = "sev1") => {
    const incident = newId("inc", Date.now(), random);
    await run(actor, "incident.declare", { id: incident, title: "Checkout is down", severity });
    return {
      incident,
      event: (await events(incident)).find((e) => e.type === "incident.declared")!,
    };
  };
  const timeline = (incident: string) =>
    withShard((shard) =>
      shard.store
        .scan("timeline")
        .filter((row): row is TimelineRow => row.incidentId === incident)
        .sort((a, b) => a.seq - b.seq),
    );
  const escalation = (incident: string) =>
    withShard((shard) => shard.store.get("incidents", incident)?.escalation);
  /** Makes the run's next level due now, as if its timeout passed. */
  const due = (incident: string) =>
    withShard((shard) => {
      const at = Date.now() - 1;
      const row = shard.store.get("incidents", incident)!;
      shard.store.update("incidents", incident, { escalation: { ...row.escalation!, nextAt: at } });
      shard.store.update("escalation_timers", incident, { at });
    });
  /** Escalation levels the outbox holds for `incident`, as `level/round` with the members paged. */
  const levels = async (incident: string) =>
    (await events(incident))
      .filter((event) => event.type === "escalation.paged")
      .map((event) => event.data as { level: number | null; round: number; userIds: string[] });
  return { id, stub, withShard, run, device, declare, events, timeline, escalation, due, levels };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

const SCHEDULE = "sch_01JB0000000000000000000001";

/** A schedule with Caio always on call (a weekly rotation of one, started in the past), and a default policy. */
async function withPolicy(
  ws: Workspace,
  levels: { targets: { kind: "schedule" | "member"; id: string }[]; timeoutMinutes?: number }[] = [
    { targets: [{ kind: "schedule", id: SCHEDULE }] },
    { targets: [{ kind: "member", id: eva.id }] },
  ],
  repeat = 0,
) {
  await ws.run(
    ana,
    "schedule.create",
    {
      id: SCHEDULE,
      name: "Primary",
      timeZone: "UTC",
      layers: [
        {
          id: newId("lyr", Date.now(), random),
          name: "",
          members: [caio.id],
          startDate: "2026-01-01",
          handoffTime: "09:00",
          unit: "weeks",
          count: 1,
        },
      ],
    },
    false,
  );
  await ws.run(
    ana,
    "escalation.createPolicy",
    {
      id: newId("esc", Date.now(), random),
      name: "Checkout",
      levels: levels.map((level) => ({
        id: newId("lvl", Date.now(), random),
        targets: level.targets,
        timeoutMinutes: level.timeoutMinutes ?? 5,
      })),
      repeat,
      isDefault: true,
    },
    false,
  );
}

/** A relay that accepts every push and remembers which device tokens it got. */
function relay() {
  const tokens: string[] = [];
  const send: Fetch = async (request) => {
    const body = (await request.json()) as { deviceToken: string };
    tokens.push(body.deviceToken);
    return Response.json({ status: 200 });
  };
  return { tokens, send };
}

const relayEnv = {
  WORKSPACE: env.WORKSPACE,
  RELAY_URL: "https://relay.test",
  RELAY_SEND_TOKEN: "test-token",
};

async function deliver(event: BrigadeEvent, send: Fetch) {
  const batch = createMessageBatch("brigade-events", [
    { id: "msg-0", timestamp: new Date(), attempts: 1, body: event },
  ]);
  const ctx = createExecutionContext();
  await consumeEvents(batch, relayEnv, send);
  return getQueueResult(batch, ctx);
}

const byId = (a: string | null, b: string | null) => String(a).localeCompare(String(b));

/** Who each push went to, by member, from the devices' tokens. */
async function pagedMembers(ws: Workspace, tokens: string[]) {
  return ws.withShard((shard) =>
    [
      ...new Set(
        shard.store
          .scan("devices")
          .filter((device) => tokens.includes(device.pushToken))
          .map((device) => device.userId),
      ),
    ].sort(),
  );
}

describe("paging through the default policy", () => {
  test("without a default policy the interim rule pages, unchanged", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    const { tokens, send } = relay();
    await deliver(event, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, caio.id, eva.id]);
    expect(await ws.escalation(incident)).toBeUndefined();
  });

  test("a declared incident pages only whoever is on call, and arms the alarm for the next level", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    const { tokens, send } = relay();
    await deliver(event, send);
    expect(await pagedMembers(ws, tokens)).toEqual([caio.id]);
    const run = await ws.escalation(incident);
    expect(run).toMatchObject({ status: "running", eventId: event.id });
    expect(run!.pages).toEqual([expect.objectContaining({ level: 1, userIds: [caio.id] })]);
    const alarm = await ws.withShard((_shard, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(run!.nextAt!);
    // A redelivery of the same event pages nobody twice and starts no second run.
    const again = relay();
    await deliver(event, again.send);
    expect(again.tokens).toEqual([]);
    expect(await ws.levels(incident)).toHaveLength(1);
  });

  test("the alarm fires the next level when nobody acknowledged, and its event pages it", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    const [, second] = await ws.levels(incident);
    expect(second).toMatchObject({ level: 2, round: 0, userIds: [eva.id] });
    const paged = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    const { tokens, send } = relay();
    await deliver(paged, send);
    expect(await pagedMembers(ws, tokens)).toEqual([eva.id]);
    expect((await ws.timeline(incident)).filter((row) => row.kind === "escalated")).toEqual([
      expect.objectContaining({ level: 1, reason: "started", actor: "sys_escalation" }),
      expect.objectContaining({ level: 2, reason: "timeout", actor: "sys_escalation" }),
    ]);
    // The alarm again, before the next timeout: nothing fires twice.
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect(await ws.levels(incident)).toHaveLength(2);
  });

  test("an ack stops the run: no level fires after it, and a level already queued is not sent", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 3);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const queued = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    await ws.run(caio, "incident.ack", { id: incident }, false);
    expect(await ws.escalation(incident)).toMatchObject({ status: "acknowledged", nextAt: null });
    expect(await ws.withShard((shard) => shard.store.scan("escalation_timers"))).toEqual([]);
    const { tokens, send } = relay();
    await deliver(queued, send);
    expect(tokens).toEqual([]);
    await runDurableObjectAlarm(ws.stub);
    expect(await ws.levels(incident)).toHaveLength(2);
  });

  test("a severity raised while a run is under way pages the level paged last again", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev3");
    await deliver(event, relay().send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" }, false);
    const raised = (await ws.events(incident)).find((e) => e.type === "incident.severity_changed")!;
    const { tokens, send } = relay();
    await deliver(raised, send);
    expect(await pagedMembers(ws, tokens)).toEqual([caio.id]);
    expect(await ws.levels(incident)).toHaveLength(1);
  });

  test("whoever declared the incident is not pushed, but counts as reached", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(caio);
    const { tokens, send } = relay();
    await deliver(event, send);
    expect(tokens).toEqual([]);
    expect(await ws.escalation(incident)).toMatchObject({
      status: "running",
      pages: [expect.objectContaining({ level: 1, userIds: [caio.id] })],
    });
  });
});

describe("fallbacks (the paging path's)", () => {
  test("a level whose on-call member has no device escalates at once, and says so", async () => {
    const ws = await workspace();
    await ws.device(eva);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    const { tokens, send } = relay();
    await deliver(event, send);
    expect(await pagedMembers(ws, tokens)).toEqual([eva.id]);
    const entries = await ws.timeline(incident);
    expect(entries.filter((row) => row.kind === "escalated")).toEqual([
      expect.objectContaining({ level: 2, reason: "unreachable", userIds: [eva.id] }),
    ]);
    expect(entries.filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: caio.id, reason: "no_devices" }),
    ]);
  });

  test("a schedule with nobody on call is recorded by name and skipped", async () => {
    const ws = await workspace();
    await ws.device(eva);
    await withPolicy(ws);
    // Take Caio out of the rotation (the layer keeps no one): a gap.
    await ws.run(ana, "member.changeRole", { id: caio.id, from: "responder", to: "viewer" }, true);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: null, reason: "nobody_on_call", schedule: "Primary" }),
    ]);
  });

  test("when no level can reach anyone, everyone who can respond is paged (the interim rule)", async () => {
    const ws = await workspace();
    for (const member of [bia, eva]) await ws.device(member);
    // Level 1: the schedule (Caio, no device). Level 2: Ana (no device).
    await withPolicy(ws, [
      { targets: [{ kind: "schedule", id: SCHEDULE }] },
      { targets: [{ kind: "member", id: ana.id }] },
    ]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    const { tokens, send } = relay();
    await deliver(event, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, eva.id]);
    expect(await ws.escalation(incident)).toMatchObject({
      status: "exhausted",
      pages: [expect.objectContaining({ level: null })],
    });
    const failed = (await ws.timeline(incident)).filter((row) => row.kind === "page_failed");
    expect(failed.map((row) => row.userId).sort(byId)).toEqual([ana.id, caio.id]);
  });

  test("a level timing out into levels nobody can reach falls back on its own event", async () => {
    const ws = await workspace();
    for (const member of [caio, bia]) await ws.device(member);
    await withPolicy(ws, [
      { targets: [{ kind: "schedule", id: SCHEDULE }] },
      { targets: [{ kind: "member", id: eva.id }] },
    ]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const fallback = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    expect(fallback.data).toMatchObject({ level: null, started: false });
    const { tokens, send } = relay();
    await deliver(fallback, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, caio.id]);
  });

  test("a deleted schedule and a removed member are taken out of the policy, visibly", async () => {
    const ws = await workspace();
    await withPolicy(ws);
    await ws.run(ana, "schedule.delete", { id: SCHEDULE }, false);
    await ws.run(ana, "member.remove", { id: eva.id, role: "responder", reason: "removed" });
    const policy = (await ws.withShard((shard) => shard.store.scan("escalation_policies")))[0]!;
    expect(policy.levels.map((level) => level.targets)).toEqual([[], []]);
    const updates = (await ws.events()).filter((e) => e.type === "escalation_policy.updated");
    expect(updates.map((e) => (e.data as { reason: string }).reason)).toEqual([
      "schedule_deleted",
      "member_removed",
    ]);
  });

  test("a restart mid-escalation re-arms the alarm from stored state, and the level still fires", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await ws.withShard(async (_shard, state, instance) => {
      // An eviction lost the alarm; the object wakes again (a new instance over the same storage).
      await state.storage.deleteAlarm();
      const Restarted = instance.constructor as typeof WorkspaceDO;
      new Restarted(state, env);
      await vi.waitFor(async () => expect(await state.storage.getAlarm()).not.toBeNull());
    });
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 2]);
  });

  test("a dead-lettered level is recorded on the timeline", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const second = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    const batch = createMessageBatch("brigade-events-dlq", [
      { id: "dlq-0", timestamp: new Date(), attempts: 1, body: second },
    ]);
    const ctx = createExecutionContext();
    await consumeDeadLetters(batch, { WORKSPACE: env.WORKSPACE });
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(["dlq-0"]);
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: null, reason: "dead_lettered" }),
    ]);
  });
});
