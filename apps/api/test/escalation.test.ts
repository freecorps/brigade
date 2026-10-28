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
  ESCALATION_ACTOR as ESCALATION,
  MONITOR_ACTOR,
  newId,
  STATUS_DOMAIN_ID,
  type Actor,
  type Role,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import { Escalations, ESCALATION_RETRY_MS, MAX_LEVELS_PER_ALARM } from "../src/escalation.ts";
import { consumeDeadLetters, consumeEvents, type Fetch } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { CF_CALL_MS, type Fetch as CloudflareFetch } from "../src/status-domain-cf.ts";
import type { DomainChecker } from "../src/status-domain-check.ts";
import { StatusPublisher } from "../src/status-page.ts";
import { STATUS_PUSH_BUDGET_MS, WorkspaceDO } from "../src/workspace.ts";

const MINUTE = 60_000;
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
  /** With `voip`, the phone registers a PushKit token too, so a page can ring it (RFC 0010). */
  const device = async (actor: Actor, voip = false) => {
    const recipient = await generateRecipient();
    await run(actor, "device.register", {
      id: newId("dev", Date.now(), random),
      platform: "ios",
      environment: "sandbox",
      pushToken: toBase64url(random(32)).replace(/[-_]/g, "a"),
      voipToken: voip ? toBase64url(random(32)).replace(/[-_]/g, "b") : null,
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
      .map(
        (event) =>
          event.data as { level: number | null; round: number; userIds: string[]; reason: string },
      );
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
  extra: Record<string, unknown> = {},
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
      ...extra,
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

async function deadLetter(event: BrigadeEvent) {
  const batch = createMessageBatch("brigade-events-dlq", [
    { id: "dlq-0", timestamp: new Date(), attempts: 1, body: event },
  ]);
  const ctx = createExecutionContext();
  await consumeDeadLetters(batch, { WORKSPACE: env.WORKSPACE });
  return getQueueResult(batch, ctx);
}

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

  test("an incident type's own policy pages its incidents, with or without a default", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    const policy = newId("esc", Date.now(), random);
    await ws.run(
      ana,
      "escalation.createPolicy",
      {
        id: policy,
        name: "Payments",
        levels: [
          {
            id: newId("lvl", Date.now(), random),
            targets: [{ kind: "member", id: eva.id }],
            timeoutMinutes: 5,
          },
        ],
        repeat: 0,
        isDefault: false,
      },
      false,
    );
    const type = newId("typ", Date.now(), random);
    await ws.run(
      ana,
      "incidentType.create",
      {
        id: type,
        name: "Payments outage",
        description: "",
        defaultSeverity: "sev1",
        escalationPolicyId: policy,
        requiredFields: [],
      },
      false,
    );
    const incident = newId("inc", Date.now(), random);
    await ws.run(caio, "incident.declare", {
      id: incident,
      title: "Card payments fail",
      typeId: type,
    });
    const event = (await ws.events(incident)).find((e) => e.type === "incident.declared")!;
    const { tokens, send } = relay();
    await deliver(event, send);
    expect(await pagedMembers(ws, tokens)).toEqual([eva.id]);
    expect(await ws.escalation(incident)).toMatchObject({ policyId: policy, status: "running" });
    // Without a type, and with no default, the interim rule still pages everyone who can respond.
    const { event: plain } = await ws.declare(MONITOR_ACTOR);
    const other = relay();
    await deliver(plain, other.send);
    expect(await pagedMembers(ws, other.tokens)).toEqual([bia.id, caio.id, eva.id]);
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

  test("a SEV2's escalation level rings members on the default, not those with calls for SEV1 only; a refused call never escalates early", async () => {
    for (const calls of ["sev1_sev2", "sev1"] as const) {
      const ws = await workspace();
      await ws.device(caio, true);
      await ws.device(eva, true);
      await ws.run(eva, "member.setCalls", { calls });
      await withPolicy(ws);
      const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev2");
      const kinds: string[] = [];
      // Every call is refused: only the alert push decides the page.
      const send: Fetch = async (request) => {
        const body = (await request.json()) as { kind?: string };
        kinds.push(body.kind ?? "alert");
        return body.kind === "call"
          ? Response.json({ status: 400, reason: "BadDeviceToken" }, { status: 502 })
          : Response.json({ status: 200 });
      };
      await deliver(event, send);
      // A SEV2's first page does not ring.
      expect(kinds).toEqual(["alert"]);
      // No early escalation: level 1's alert got through.
      expect(await ws.levels(incident)).toHaveLength(1);
      await ws.due(incident);
      expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
      const paged = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
      await deliver(paged, send);
      expect(kinds, calls).toEqual(
        calls === "sev1" ? ["alert", "alert"] : ["alert", "alert", "call"],
      );
      // The refused call left the level as its alert made it: no retry, no failure, no early next level.
      expect((await ws.timeline(incident)).map((row) => row.kind)).not.toContain("page_failed");
      expect(await ws.levels(incident)).toHaveLength(2);
    }
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

describe("escalating from a severity", () => {
  test("below the policy's severity, level 1 is paged once and no later level, repeat or fallback ever fires", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 2, { minSeverity: "sev2" });
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev3");
    const { tokens, send } = relay();
    await deliver(event, send);
    expect(await pagedMembers(ws, tokens)).toEqual([caio.id]);
    expect(await ws.escalation(incident)).toMatchObject({
      status: "paged_once",
      once: "sev2",
      nextAt: null,
    });
    expect(
      await ws.withShard((shard) => shard.store.get("escalation_timers", incident)),
    ).toBeUndefined();
    expect((await ws.timeline(incident)).at(-1)).toMatchObject({
      kind: "escalation_once",
      minSeverity: "sev2",
    });
    // The alarm, however late, fires nothing for it.
    await runDurableObjectAlarm(ws.stub);
    expect(await ws.levels(incident)).toHaveLength(1);
  });

  test("a SEV1 on the same policy escalates fully, and with it unset a SEV4 does too", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 0, { minSeverity: "sev2" });
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev1");
    await deliver(event, relay().send);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running" });
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 2]);

    const unset = await workspace();
    for (const member of [caio, eva]) await unset.device(member);
    await withPolicy(unset);
    const low = await unset.declare(MONITOR_ACTOR, "sev4");
    await deliver(low.event, relay().send);
    expect(await unset.escalation(low.incident)).toMatchObject({ status: "running" });
    await unset.due(low.incident);
    expect(await runDurableObjectAlarm(unset.stub)).toBe(true);
    expect((await unset.levels(low.incident)).map((one) => one.level)).toEqual([1, 2]);
  });

  /** The incident's `incident.severity_changed` event after Bia raised it to `severity`. */
  const raise = async (ws: Workspace, incident: string, severity: string) => {
    await ws.run(bia, "incident.setSeverity", { id: incident, severity }, false);
    return (await ws.events(incident))
      .filter((e) => e.type === "incident.severity_changed")
      .at(-1)!;
  };

  test("a SEV4 raised to SEV3 on a policy escalating from SEV3 starts a full run, once", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 0, { minSeverity: "sev3" });
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev4");
    await deliver(event, relay().send);
    expect(await ws.escalation(incident)).toMatchObject({ status: "paged_once", once: "sev3" });
    const raised = await raise(ws, incident, "sev3");
    const { tokens, send } = relay();
    await deliver(raised, send);
    expect(await pagedMembers(ws, tokens)).toEqual([caio.id]);
    const run = (await ws.escalation(incident))!;
    expect(run).toMatchObject({ status: "running", eventId: raised.id, paged: 1 });
    expect(run.once).toBeUndefined();
    // Redelivered: no new run and nobody paged twice.
    const again = relay();
    await deliver(raised, again.send);
    expect(again.tokens).toEqual([]);
    expect(await ws.escalation(incident)).toMatchObject({ eventId: raised.id, paged: 1 });
    // Level 2 fires at its timeout, as in any full run.
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 1, 2]);
  });

  test("a SEV4 raised to SEV3 on a policy escalating from SEV2 pages nothing and stays paged once", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 0, { minSeverity: "sev2" });
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev4");
    await deliver(event, relay().send);
    const raised = await raise(ws, incident, "sev3");
    const { tokens, send } = relay();
    await deliver(raised, send);
    expect(tokens).toEqual([]);
    expect(await ws.escalation(incident)).toMatchObject({
      status: "paged_once",
      eventId: event.id,
      paged: 1,
    });
    expect(await ws.levels(incident)).toHaveLength(1);
  });

  test("a lost first page of a run that pages once is paged again once, and the run still pages once", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 2, { minSeverity: "sev2" });
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev3");
    // The shard never planned it: the Queue gave up on it, and the dead-letter consumer records it.
    await deadLetter(event);
    expect(await ws.escalation(incident)).toMatchObject({
      status: "paged_once",
      eventId: event.id,
      paged: 2,
    });
    const paged = (await ws.events(incident)).filter((e) => e.type === "escalation.paged");
    const repaged = paged.filter((e) => (e.data as { lost?: string }).lost !== undefined);
    expect(repaged).toHaveLength(1);
    expect(repaged[0]!.data).toMatchObject({ level: 1, userIds: [caio.id], lost: event.id });
    const { tokens, send } = relay();
    await deliver(repaged[0]!, send);
    expect(await pagedMembers(ws, tokens)).toEqual([caio.id]);
    expect(await ws.escalation(incident)).toMatchObject({ status: "paged_once", paged: 2 });
    // Never a third time: the page again lost too, or the first dead-lettered again, is only recorded.
    await deadLetter(repaged[0]!);
    await deadLetter(event);
    expect(await ws.levels(incident)).toHaveLength(2);
    expect(await ws.escalation(incident)).toMatchObject({ status: "paged_once", paged: 2 });
    await runDurableObjectAlarm(ws.stub);
    expect(await ws.levels(incident)).toHaveLength(2);
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
    // Recorded with the page it belongs to (the run's first), so the card puts it on that page.
    expect(entries.filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: caio.id, reason: "no_devices", run: event.id, step: 1 }),
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
    // The re-armed alarm is already due, so the runtime may fire it before this does: either way the level fires.
    await runDurableObjectAlarm(ws.stub);
    await vi.waitFor(async () =>
      expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 2]),
    );
  });

  test("a status page push hung on KV never holds a level: it fires on time, alarm after alarm", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 3);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    // A public page with a change to push, and a KV that never answers.
    await ws.run(ana, "statusPage.configure", {
      slug: `esc-${Date.now().toString(36)}`,
      title: "Acme",
      locale: "en",
      enabled: true,
    });
    const real = await ws.withShard((shard, state, instance) => {
      const real: unknown = Reflect.get(instance, "status");
      const hanging = {
        put: () => new Promise(() => {}),
        delete: () => new Promise(() => {}),
      } as unknown as KVNamespace;
      Reflect.set(
        instance,
        "status",
        new StatusPublisher({
          shard,
          sql: state.storage.sql,
          kv: hanging,
          db: env.DB,
          randomBytes: random,
          log: () => {},
          committed: () => {},
          wake: () => {},
        }),
      );
      Reflect.set(instance, "statusBudgetMs", 50);
      return real;
    });
    try {
      // The second level, then the first again (a second round): each the alarm after a timeout.
      for (const level of [2, 3]) {
        await ws.due(incident);
        const took = await ws.withShard(async (_shard, state, instance) => {
          const started = Date.now();
          await instance.alarm();
          const alarm = await state.storage.getAlarm();
          // The alarm does not come straight back for the stuck push.
          expect(alarm === null || alarm > Date.now() + 100).toBe(true);
          return Date.now() - started;
        });
        // The first alarm waited its budget on the push; the next did not wait on it at all.
        expect(took).toBeLessThan(level === 2 ? 2000 : 1000);
        expect(await ws.levels(incident)).toHaveLength(level);
      }
    } finally {
      await ws.withShard((_shard, _state, instance) => Reflect.set(instance, "status", real));
    }
  });

  test("a slow status page push stops holding the alarm when a level falls due, so the level fires on time", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.run(ana, "statusPage.configure", {
      slug: `esc-${Date.now().toString(36)}`,
      title: "Acme",
      locale: "en",
      enabled: true,
    });
    // A KV that answers only when the test lets it, and a push budget far longer than the test: if the alarm comes
    // back while the push still hangs, only the level falling due can have ended its wait. No wall-clock bound, so a
    // loaded machine cannot fail it.
    let release = () => {};
    let released = false;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        released = true;
        resolve();
      };
    });
    const hang = () => gate;
    const real = await ws.withShard((shard, state, instance) => {
      const real: unknown = Reflect.get(instance, "status");
      Reflect.set(instance, "statusBudgetMs", 10 * 60 * 1000);
      Reflect.set(
        instance,
        "status",
        new StatusPublisher({
          shard,
          sql: state.storage.sql,
          kv: { put: hang, delete: hang } as unknown as KVNamespace,
          db: env.DB,
          randomBytes: random,
          log: () => {},
          committed: () => {},
          wake: () => {},
        }),
      );
      return real;
    });
    try {
      await ws.withShard((shard) => {
        const at = Date.now() + 300;
        const row = shard.store.get("incidents", incident)!;
        shard.store.update("incidents", incident, {
          escalation: { ...row.escalation!, nextAt: at },
        });
        shard.store.update("escalation_timers", incident, { at });
      });
      await ws.withShard((_shard, _state, instance) => instance.alarm());
      // The alarm stopped waiting on the push when the level fell due, and came back for the level (the runtime may
      // have run that alarm already; if not, it runs now), all while the push still hangs.
      expect(released).toBe(false);
      // The level is due within 300 ms: run the shard's alarm until it has fired (the runtime may run it first, or run
      // it while this one waits), all while the push still hangs.
      await vi.waitFor(
        async () => {
          await runDurableObjectAlarm(ws.stub);
          expect(await ws.levels(incident)).toHaveLength(2);
        },
        { timeout: 5000, interval: 100 },
      );
      expect(released).toBe(false);
    } finally {
      release();
      await ws.withShard((_shard, _state, instance) => {
        Reflect.set(instance, "status", real);
        Reflect.set(instance, "statusBudgetMs", STATUS_PUSH_BUDGET_MS);
      });
    }
  });

  test("a status domain check never starts when a level falls due within Cloudflare's deadline, so the level fires on time", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.run(ana, "statusPage.configure", {
      slug: `esc-${Date.now().toString(36)}`,
      title: "Acme",
      locale: "en",
      enabled: true,
    });
    await ws.run(ana, "statusDomain.add", {
      hostname: "status.acme.test",
      cloudflareId: "cfh-1",
      state: "pending",
      records: [],
      error: null,
    });
    // A domain whose check is due, and a Cloudflare that never answers (only the call's own deadline would end it).
    const asked: string[] = [];
    let hang = true;
    const at = Date.now() + 300;
    await ws.withShard((shard, _state, instance) => {
      const past = Date.now() - 2 * MINUTE;
      shard.store.update("status_domain", STATUS_DOMAIN_ID, {
        createdAt: past,
        checkedAt: past,
        stateAt: past,
      });
      const deps = Reflect.get(Reflect.get(instance, "domains") as DomainChecker, "deps") as {
        config: () => unknown;
        limiter: () => unknown;
        send?: CloudflareFetch;
      };
      deps.config = () => ({
        token: "test-saas-token",
        zoneId: "zone-test",
        target: "origin.saas.test",
      });
      deps.limiter = () => undefined;
      deps.send = (request) => {
        asked.push(request.url);
        if (!hang) return Promise.resolve(new Response("bad gateway", { status: 502 }));
        return new Promise((_resolve, reject) =>
          request.signal.addEventListener("abort", () => reject(request.signal.reason)),
        );
      };
      // The next level falls due well within one Cloudflare call.
      const row = shard.store.get("incidents", incident)!;
      shard.store.update("incidents", incident, { escalation: { ...row.escalation!, nextAt: at } });
      shard.store.update("escalation_timers", incident, { at });
    });
    const took = await ws.withShard(async (_shard, _state, instance) => {
      const started = Date.now();
      await instance.alarm();
      return Date.now() - started;
    });
    hang = false;
    expect(asked).toEqual([]);
    expect(took).toBeLessThan(CF_CALL_MS);
    await vi.waitFor(
      async () => {
        await runDurableObjectAlarm(ws.stub);
        expect(await ws.levels(incident)).toHaveLength(2);
      },
      { timeout: 5000, interval: 100 },
    );
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
      expect.objectContaining({ userId: null, reason: "dead_lettered", run: event.id, step: 2 }),
    ]);
    // Still the run's last page: level 2 is paged again on an event of its own, not left until level 3's time.
    const again = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[2]!;
    expect(again.data).toMatchObject({ level: 2, userIds: [eva.id], step: 3, started: false });
    const { tokens, send } = relay();
    await deliver(again, send);
    expect(await pagedMembers(ws, tokens)).toEqual([eva.id]);
  });

  test("a level paged again whose own event is lost too is only recorded, never paged a third time", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const second = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    await deadLetter(second);
    const again = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[2]!;
    expect(again.data).toMatchObject({ level: 2, step: 3, lost: second.id });
    expect(
      (await ws.timeline(incident)).filter((row) => row.kind === "escalated").at(-1),
    ).toMatchObject({ level: 2, again: true });
    await deadLetter(again);
    expect(await ws.levels(incident)).toHaveLength(3);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running", paged: 3 });
    expect(
      (await ws.timeline(incident))
        .filter((row) => row.kind === "page_failed")
        .map((row) => [row.reason, row.step]),
    ).toEqual([
      ["dead_lettered", 2],
      ["dead_lettered", 3],
    ]);
  });

  test("a level paged again skips the devices the lost page reached before the Queue gave up", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [
      { targets: [{ kind: "schedule", id: SCHEDULE }] },
      {
        targets: [
          { kind: "member", id: eva.id },
          { kind: "member", id: bia.id },
        ],
      },
    ]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const second = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    // Eva's push went out before the Queue gave up on the event (the shard recorded it, then a later try threw).
    await ws.withShard((shard, state) => {
      const device = shard.store.scan("devices").find((one) => one.userId === eva.id)!;
      state.storage.sql.exec(
        "insert into page_deliveries (event_id, device_id, user_id, at) values (?, ?, ?, ?)",
        second.id,
        device.id,
        eva.id,
        Date.now(),
      );
    });
    await deadLetter(second);
    const again = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[2]!;
    expect(again.data).toMatchObject({ level: 2, userIds: [eva.id, bia.id], lost: second.id });
    const { tokens, send } = relay();
    await deliver(again, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id]);
    // Eva, reached by the lost page, is not recorded as missed by this one.
    expect(
      (await ws.timeline(incident)).filter((row) => row.kind === "page_failed" && row.step === 3),
    ).toEqual([]);
  });

  test("a lost level page dead-lettered after the run moved on is recorded, not paged again", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 1);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const second = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    // Level 1 again (the repeat) fires before level 2's event gives up.
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running", paged: 3 });
    await deadLetter(second);
    expect((await ws.levels(incident)).map((one) => [one.level, one.round])).toEqual([
      [1, 0],
      [2, 0],
      [1, 1],
    ]);
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ reason: "dead_lettered", run: event.id, step: 2 }),
    ]);
  });

  test("a first page dead-lettered before it was planned starts the run and pages level 1 again at once", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    // The shard never planned it (unreachable, or it threw): the Queue gave up on it.
    await deadLetter(event);
    const run = (await ws.escalation(incident))!;
    expect(run).toMatchObject({
      status: "running",
      eventId: event.id,
      paged: 2,
      pages: [
        expect.objectContaining({ level: 1, userIds: [caio.id] }),
        expect.objectContaining({ level: 1, userIds: [caio.id] }),
      ],
    });
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: null, reason: "dead_lettered", run: event.id, step: 1 }),
    ]);
    // Level 1 again on its own event, not a full timeout later; level 2 keeps its time.
    const [again] = (await ws.events(incident)).filter(
      (e) => e.type === "escalation.paged" && (e.data as { started: boolean }).started === false,
    );
    expect(again!.data).toMatchObject({ level: 1, step: 2 });
    const first = relay();
    await deliver(again!, first.send);
    expect(await pagedMembers(ws, first.tokens)).toEqual([caio.id]);
    const alarm = await ws.withShard((_shard, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(run.nextAt!);
    // Once: the dead letter again changes nothing.
    await deadLetter(event);
    expect(await ws.levels(incident)).toHaveLength(2);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 1, 2]);
    const second = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[2]!;
    const { tokens, send } = relay();
    await deliver(second, send);
    expect(await pagedMembers(ws, tokens)).toEqual([eva.id]);
  });

  test("a dead-lettered first page whose only reach was the declarer pages nobody again", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(caio);
    await deadLetter(event);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running", paged: 1 });
    expect(await ws.levels(incident)).toHaveLength(1);
  });

  test("a dead-lettered declaration belongs to no page of a run a later event started", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    // Declared at SEV3, its page not delivered yet; raised to SEV1, that page starts the run.
    const { event: declared, incident } = await ws.declare(MONITOR_ACTOR, "sev3");
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" }, false);
    const raised = (await ws.events(incident)).find((e) => e.type === "incident.severity_changed")!;
    await deliver(raised, relay().send);
    expect(await ws.escalation(incident)).toMatchObject({ eventId: raised.id, paged: 1 });
    await deadLetter(declared);
    const failed = (await ws.timeline(incident)).filter((row) => row.kind === "page_failed");
    expect(failed).toEqual([expect.objectContaining({ userId: null, reason: "dead_lettered" })]);
    expect(failed[0]).not.toHaveProperty("run");
    expect(failed[0]).not.toHaveProperty("step");
    // Nor is the run's page paged again.
    expect(await ws.escalation(incident)).toMatchObject({ eventId: raised.id, paged: 1 });
  });

  for (const how of ["delivered", "dead-lettered"] as const) {
    test(`a declaration ${how} after a later event's run ended starts no new run`, async () => {
      const ws = await workspace();
      for (const member of [bia, caio, eva]) await ws.device(member);
      await withPolicy(ws);
      // Declared at SEV3, its page still with the Queue; raised to SEV1, that page starts the run, which ends.
      const { event: declared, incident } = await ws.declare(MONITOR_ACTOR, "sev3");
      await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" }, false);
      const raised = (await ws.events(incident)).find(
        (e) => e.type === "incident.severity_changed",
      )!;
      await deliver(raised, relay().send);
      for (let i = 0; i < 2; i++) {
        await ws.due(incident);
        await runDurableObjectAlarm(ws.stub);
      }
      expect(await ws.escalation(incident)).toMatchObject({
        eventId: raised.id,
        status: "exhausted",
        paged: 3,
      });
      const { tokens, send } = relay();
      if (how === "delivered") await deliver(declared, send);
      else await deadLetter(declared);
      expect(tokens).toEqual([]);
      expect(await ws.escalation(incident)).toMatchObject({
        eventId: raised.id,
        status: "exhausted",
        paged: 3,
      });
      expect(await ws.levels(incident)).toHaveLength(3);
      const failed = (await ws.timeline(incident)).filter((row) => row.kind === "page_failed");
      if (how === "delivered") expect(failed).toEqual([]);
      else {
        expect(failed).toEqual([
          expect.objectContaining({ userId: null, reason: "dead_lettered" }),
        ]);
        expect(failed[0]).not.toHaveProperty("run");
      }
    });
  }

  test("a level the shard keeps refusing is on the timeline at once, and pages everyone after 3 minutes", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    // A run `escalation.advance` refuses (it has no page to go on from), due long ago: the alarm came late, so the
    // 3 minutes count from its first refusal, not from when the level was due.
    await ws.withShard((shard) => {
      const row = shard.store.get("incidents", incident)!;
      const at = Date.now() - 10 * 60_000;
      shard.store.update("incidents", incident, {
        escalation: { ...row.escalation!, pages: [], nextAt: at },
      });
      shard.store.update("escalation_timers", incident, { at });
    });
    await runDurableObjectAlarm(ws.stub);
    const stalled = () =>
      ws.timeline(incident).then((rows) => rows.filter((row) => row.kind === "page_failed"));
    expect(await stalled()).toEqual([
      expect.objectContaining({ userId: null, reason: "escalation_stalled" }),
    ]);
    // Tried again a minute later, and not dropped.
    const timer = await ws.withShard((shard) => shard.store.get("escalation_timers", incident));
    expect(timer!.at).toBeGreaterThan(Date.now());
    expect(timer!.at).toBeLessThanOrEqual(Date.now() + ESCALATION_RETRY_MS);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running" });
    // Still refused on the retry, before 3 minutes: the failure is not recorded twice.
    await ws.withShard((shard) =>
      shard.store.update("escalation_timers", incident, { at: Date.now() - 1 }),
    );
    await runDurableObjectAlarm(ws.stub);
    expect(await stalled()).toHaveLength(1);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running" });
    // Refused for over 3 minutes: everyone who can respond is paged, and the run ends.
    await ws.withShard((shard) => {
      const timer = shard.store.get("escalation_timers", incident)!;
      expect(timer.failingSince).toBeLessThanOrEqual(Date.now());
      shard.store.update("escalation_timers", incident, {
        at: Date.now() - 1,
        failingSince: Date.now() - 4 * 60_000,
      });
    });
    await runDurableObjectAlarm(ws.stub);
    expect(await ws.escalation(incident)).toMatchObject({ status: "exhausted", nextAt: null });
    expect(await ws.withShard((shard) => shard.store.scan("escalation_timers"))).toEqual([]);
    const fallback = (await ws.events(incident))
      .filter((e) => e.type === "escalation.paged")
      .at(-1)!;
    expect(fallback.data).toMatchObject({ level: null, reason: "stalled", started: false });
    const { tokens, send } = relay();
    await deliver(fallback, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, caio.id, eva.id]);
  });

  test("a run nobody acknowledged pages everyone who can respond once at the end, not just the commander", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [{ targets: [{ kind: "member", id: eva.id }] }]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    // A commander is assigned: the end of the run still pages everyone who can respond, the commander included.
    await ws.run(ana, "incident.assignRole", { id: incident, role: "commander", userId: bia.id });
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    expect((await ws.levels(incident)).map((one) => [one.level, one.reason])).toEqual([
      [1, "started"],
      [null, "exhausted"],
    ]);
    const last = (await ws.events(incident)).filter((e) => e.type === "escalation.paged").at(-1)!;
    const { tokens, send } = relay();
    await deliver(last, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, caio.id, eva.id]);
    expect(await ws.escalation(incident)).toMatchObject({ status: "exhausted" });
    // Once: the alarm has nothing left to fire.
    await runDurableObjectAlarm(ws.stub);
    expect(await ws.levels(incident)).toHaveLength(2);
  });

  test("`/inc escalate` past the last level of the last round pages everyone who can respond, not just the commander", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [{ targets: [{ kind: "member", id: eva.id }] }]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await ws.run(ana, "incident.assignRole", { id: incident, role: "commander", userId: bia.id });
    await deliver(event, relay().send);
    // A member asks for the next level on the last level of the last round: the run ends on everyone.
    await ws.run(caio, "escalation.now", { incidentId: incident, step: 1 });
    expect((await ws.levels(incident)).map((one) => [one.level, one.reason])).toEqual([
      [1, "started"],
      [null, "manual"],
    ]);
    expect(await ws.escalation(incident)).toMatchObject({ status: "exhausted" });
    const last = (await ws.events(incident)).filter((e) => e.type === "escalation.paged").at(-1)!;
    const { tokens, send } = relay();
    await deliver(last, send);
    // As the timeline says: everyone who can respond, the commander included.
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, caio.id, eva.id]);
    const entry = (await ws.timeline(incident)).filter((row) => row.kind === "escalated").at(-1);
    expect(entry).toMatchObject({ level: null, reason: "manual" });
    // The run ended, as the alarm's would have: said once, for whoever acts on it.
    expect(
      (await ws.events(incident)).filter((e) => e.type === "escalation.exhausted"),
    ).toHaveLength(1);
  });

  test("a one-level policy where the person on call declared it pages everyone else at its timeout", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [{ targets: [{ kind: "schedule", id: SCHEDULE }] }]);
    const { event, incident } = await ws.declare(caio);
    const first = relay();
    await deliver(event, first.send);
    expect(first.tokens).toEqual([]);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const last = (await ws.events(incident)).filter((e) => e.type === "escalation.paged").at(-1)!;
    expect(last.data).toMatchObject({ level: null, reason: "exhausted" });
    const { tokens, send } = relay();
    await deliver(last, send);
    // Everyone who can respond but the declarer, who knows.
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, eva.id]);
  });

  test("a dead-lettered first page that fell back to everyone pages everyone again, on its own event", async () => {
    const ws = await workspace();
    for (const member of [bia, eva]) await ws.device(member);
    // No level can reach anyone (Caio and Ana have no device): the run ends on its first page, the interim rule.
    await withPolicy(ws, [
      { targets: [{ kind: "schedule", id: SCHEDULE }] },
      { targets: [{ kind: "member", id: ana.id }] },
    ]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deadLetter(event);
    expect((await ws.levels(incident)).map((one) => [one.level, one.reason])).toEqual([
      [null, "unreachable"],
      [null, "unreachable"],
    ]);
    const again = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    expect(again.data).toMatchObject({ started: false, step: 2 });
    const { tokens, send } = relay();
    await deliver(again, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, eva.id]);
    // Once: the dead letter again changes nothing.
    await deadLetter(event);
    expect(await ws.levels(incident)).toHaveLength(2);
  });

  test("a level's event still retried when a later level ended the run on everyone still pages", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    // Level 3 is Ana, with no device: when it fires, the run ends on everyone who can respond.
    await withPolicy(ws, [
      { targets: [{ kind: "schedule", id: SCHEDULE }] },
      { targets: [{ kind: "member", id: eva.id }] },
      { targets: [{ kind: "member", id: ana.id }] },
    ]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    // Level 2's event is still with the Queue (the shard failed its first deliveries) when level 3 fires.
    const second = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    expect(second.data).toMatchObject({ level: 2, step: 2 });
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    expect(await ws.escalation(incident)).toMatchObject({
      status: "exhausted",
      paged: 3,
      pages: [
        expect.objectContaining({ level: 1 }),
        expect.objectContaining({ level: 2 }),
        expect.objectContaining({ level: null, reason: "unreachable" }),
      ],
    });
    const { tokens, send } = relay();
    await deliver(second, send);
    expect(await pagedMembers(ws, tokens)).toEqual([eva.id]);
  });

  test("a lost end page at a later step (commander first) is paged again, on its own event", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    // Level 2 is Ana, with no device: level 1 times out into the interim rule, which asks the commander first.
    await withPolicy(ws, [
      { targets: [{ kind: "schedule", id: SCHEDULE }] },
      { targets: [{ kind: "member", id: ana.id }] },
    ]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await ws.run(ana, "incident.assignRole", { id: incident, role: "commander", userId: bia.id });
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const end = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    expect(end.data).toMatchObject({ level: null, reason: "unreachable", step: 2 });
    await deadLetter(end);
    const again = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[2]!;
    expect(again.data).toMatchObject({
      level: null,
      reason: "unreachable",
      run: event.id,
      step: 3,
      started: false,
    });
    const { tokens, send } = relay();
    await deliver(again, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id]);
    // Once: the dead letter again changes nothing.
    await deadLetter(end);
    expect(await ws.levels(incident)).toHaveLength(3);
  });

  test("a lost end page of a run nobody acknowledged pages everyone again, the commander not first", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [{ targets: [{ kind: "member", id: eva.id }] }]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await ws.run(ana, "incident.assignRole", { id: incident, role: "commander", userId: bia.id });
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const end = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    expect(end.data).toMatchObject({ level: null, reason: "exhausted", step: 2 });
    await deadLetter(end);
    const again = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[2]!;
    expect(again.data).toMatchObject({ level: null, reason: "exhausted", step: 3, started: false });
    const { tokens, send } = relay();
    await deliver(again, send);
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, caio.id, eva.id]);
    // Ana (no device) is recorded on the page sent again, the loss on the one lost.
    expect(
      (await ws.timeline(incident))
        .filter((row) => row.kind === "page_failed")
        .map((row) => [row.userId, row.reason, row.step]),
    ).toEqual([
      [null, "dead_lettered", 2],
      [ana.id, "no_devices", 3],
    ]);
  });

  test("an end page paged again whose own event is lost too is only recorded, and the run keeps its end", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [{ targets: [{ kind: "member", id: eva.id }] }]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const ended = (await ws.escalation(incident))!;
    const end = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    await deadLetter(end);
    const again = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[2]!;
    expect(again.data).toMatchObject({ level: null, reason: "exhausted", step: 3, lost: end.id });
    await deadLetter(again);
    expect(await ws.levels(incident)).toHaveLength(3);
    expect(await ws.escalation(incident)).toMatchObject({
      status: "exhausted",
      paged: 3,
      endedAt: ended.endedAt,
    });
    const entries = await ws.timeline(incident);
    expect(entries.filter((row) => row.kind === "escalation_exhausted")).toHaveLength(1);
    expect(entries.filter((row) => row.kind === "escalated").at(-1)).toMatchObject({
      level: null,
      again: true,
    });
  });

  test("a redelivered first page after the run moved past the pages the row keeps sends nothing", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await ws.run(ESCALATION, "escalation.start", {
      incidentId: incident,
      eventId: event.id,
      causedBy: MONITOR_ACTOR.id,
    });
    // As if the run had made 30 pages: the row keeps its last 20, so its first is gone.
    await ws.withShard((shard) => {
      const row = shard.store.get("incidents", incident)!;
      shard.store.update("incidents", incident, { escalation: { ...row.escalation!, paged: 30 } });
    });
    const { tokens, send } = relay();
    await deliver(event, send);
    expect(tokens).toEqual([]);
  });

  test("when only whoever declared it can respond, the end of the run says nobody else could be paged", async () => {
    const ws = await workspace();
    for (const member of [ana, bia]) await ws.device(member);
    await withPolicy(ws, [{ targets: [{ kind: "member", id: ana.id }] }]);
    for (const [member, from] of [
      [bia, "admin"],
      [caio, "responder"],
      [eva, "responder"],
    ] as const) {
      await ws.run(ana, "member.changeRole", { id: member.id, from, to: "viewer" });
    }
    const { event, incident } = await ws.declare(ana);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const last = (await ws.events(incident)).filter((e) => e.type === "escalation.paged").at(-1)!;
    expect(last.data).toMatchObject({ level: null, reason: "exhausted" });
    const { tokens, send } = relay();
    await deliver(last, send);
    expect(tokens).toEqual([]);
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: null, reason: "nobody_else", run: event.id, step: 2 }),
    ]);
  });

  test("a level queued before an ack is not sent after the incident is reopened", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const queued = (await ws.events(incident)).filter((e) => e.type === "escalation.paged")[1]!;
    await ws.run(caio, "incident.ack", { id: incident }, false);
    await ws.run(caio, "incident.setStatus", { id: incident, status: "resolved" }, false);
    await ws.run(caio, "incident.setStatus", { id: incident, status: "investigating" }, false);
    const { tokens, send } = relay();
    await deliver(queued, send);
    expect(tokens).toEqual([]);
  });

  test("a run that ended pages nobody from its old events once the incident is resolved and reopened", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    const [, second, end] = (await ws.events(incident)).filter(
      (e) => e.type === "escalation.paged",
    );
    const ended = (await ws.escalation(incident))!;
    expect(ended).toMatchObject({ status: "exhausted", paged: 3 });
    await ws.run(caio, "incident.setStatus", { id: incident, status: "resolved" }, false);
    expect(await ws.escalation(incident)).toMatchObject({
      status: "resolved",
      endedAt: ended.endedAt,
    });
    await ws.run(caio, "incident.setStatus", { id: incident, status: "investigating" }, false);
    // Level 2's event, still with the Queue, sends nothing; the end page lost is not paged again.
    const { tokens, send } = relay();
    await deliver(second!, send);
    expect(tokens).toEqual([]);
    await deadLetter(end!);
    expect(await ws.levels(incident)).toHaveLength(3);
  });
});

describe("the shard's alarm", () => {
  test(`fires at most ${MAX_LEVELS_PER_ALARM} levels per run and comes back at once for the rest`, async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const incidents: string[] = [];
    for (let i = 0; i <= MAX_LEVELS_PER_ALARM; i++) {
      const { event, incident } = await ws.declare(MONITOR_ACTOR);
      await ws.run(ESCALATION, "escalation.start", {
        incidentId: incident,
        eventId: event.id,
        causedBy: MONITOR_ACTOR.id,
      });
      incidents.push(incident);
    }
    const now = Date.now() + 6 * 60_000;
    const first = await ws.withShard((shard) =>
      new Escalations({ shard, log: () => {}, committed: () => {} }).fireDue(now),
    );
    expect(first).toEqual({ fired: MAX_LEVELS_PER_ALARM, next: now });
    const second = await ws.withShard((shard) =>
      new Escalations({ shard, log: () => {}, committed: () => {} }).fireDue(now),
    );
    expect(second.fired).toBe(1);
    const steps = await ws.withShard((shard) =>
      incidents.map((id) => shard.store.get("incidents", id)!.escalation!.paged),
    );
    expect(steps.every((step) => step === 2)).toBe(true);
  });
  test("a second run on a reopened incident fires its own levels, not the first run's results", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev3");
    await deliver(event, relay().send);
    await ws.due(incident);
    await runDurableObjectAlarm(ws.stub);
    expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 2]);
    await ws.run(caio, "incident.ack", { id: incident }, false);
    await ws.run(caio, "incident.setStatus", { id: incident, status: "resolved" }, false);
    await ws.run(caio, "incident.setStatus", { id: incident, status: "investigating" }, false);
    // Raised to SEV1: the page starts a second run, at step 1 again.
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" }, false);
    const raised = (await ws.events(incident)).find((e) => e.type === "incident.severity_changed")!;
    await deliver(raised, relay().send);
    expect(await ws.escalation(incident)).toMatchObject({ eventId: raised.id, paged: 1 });
    const nextAt = (await ws.escalation(incident))!.nextAt!;
    const fired = await ws.withShard((shard) =>
      new Escalations({ shard, log: () => {}, committed: () => {} }).fireDue(nextAt + 1),
    );
    expect(fired.fired).toBe(1);
    expect(await ws.escalation(incident)).toMatchObject({ eventId: raised.id, paged: 2 });
    expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 2, 1, 2]);
    const second = (await ws.events(incident)).filter((e) => e.type === "escalation.paged").at(-1)!;
    const { tokens, send } = relay();
    await deliver(second, send);
    expect(await pagedMembers(ws, tokens)).toEqual([eva.id]);
  });

  test('an "ok" that left the level due is a refusal: the alarm never comes straight back to it', async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, [{ targets: [{ kind: "schedule", id: SCHEDULE }] }], 3);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    const before = (await ws.escalation(incident))!;
    const now = before.nextAt! + 1;
    const escalations = (shard: Shard) =>
      new Escalations({ shard, log: () => {}, committed: () => {} });
    expect((await ws.withShard((shard) => escalations(shard).fireDue(now))).fired).toBe(1);
    // Put the run back as it was (step 1, due): `advance` at step 1 has a stored "ok" that fires nothing now.
    await ws.withShard((shard) => {
      shard.store.update("incidents", incident, { escalation: before });
      shard.store.update("escalation_timers", incident, { at: before.nextAt! });
    });
    // Each pass at the retry time the last one set: the level is due again each time, and refused each time.
    let at = now;
    for (let pass = 0; pass < 3; pass++) {
      const result = await ws.withShard((shard) => escalations(shard).fireDue(at));
      expect(result.fired).toBe(0);
      expect(result.next).toBe(at + ESCALATION_RETRY_MS);
      at = result.next!;
    }
    const timer = await ws.withShard((shard) => shard.store.get("escalation_timers", incident));
    expect(timer).toMatchObject({ at, failingSince: now });
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: null, reason: "escalation_stalled" }),
    ]);
  });

  test('a fallback "ok" that left the level due is a refusal too: the run is tried again, not dropped', async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    // A run `escalation.advance` refuses (no page to go on from), failing for over 3 minutes.
    const now = Date.now();
    const refused = await ws.withShard((shard) => {
      const row = shard.store.get("incidents", incident)!;
      const escalation = { ...row.escalation!, pages: [], nextAt: now - 1 };
      shard.store.update("incidents", incident, { escalation });
      shard.store.update("escalation_timers", incident, {
        at: now - 1,
        failingSince: now - 4 * 60_000,
      });
      return escalation;
    });
    const escalations = (shard: Shard) =>
      new Escalations({ shard, log: () => {}, committed: () => {} });
    expect((await ws.withShard((shard) => escalations(shard).fireDue(now))).fired).toBe(1);
    expect(await ws.escalation(incident)).toMatchObject({ status: "exhausted" });
    // Put the run back as it was: `escalation.fallback` at that step has a stored "ok" that pages nothing now.
    await ws.withShard((shard) => {
      shard.store.update("incidents", incident, { escalation: refused });
      shard.store.insert("escalation_timers", {
        id: incident,
        at: now - 1,
        failingSince: now - 4 * 60_000,
      });
    });
    const result = await ws.withShard((shard) => escalations(shard).fireDue(now));
    expect(result).toEqual({ fired: 0, next: now + ESCALATION_RETRY_MS });
    expect(
      await ws.withShard((shard) => shard.store.get("escalation_timers", incident)),
    ).toMatchObject({ at: now + ESCALATION_RETRY_MS });
    expect(await ws.escalation(incident)).toMatchObject({ status: "running" });
  });

  test("an alarm whose escalations threw comes back a retry later, not straight away", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, relay().send);
    await ws.due(incident);
    const fireDue = vi.spyOn(Escalations.prototype, "fireDue").mockImplementation(() => {
      throw new Error("storage failed");
    });
    const before = Date.now();
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    const alarm = await ws.withShard((_shard, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeGreaterThanOrEqual(before + ESCALATION_RETRY_MS);
    // The level is still due, and fires once the escalations work again.
    fireDue.mockRestore();
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 2]);
  });
});

/** A relay that refuses for good (APNs said no) every push but those to `accepted` device tokens. */
function refusing(accepted: readonly string[] = []) {
  const tokens: string[] = [];
  const send: Fetch = async (request) => {
    const body = (await request.json()) as { deviceToken: string };
    tokens.push(body.deviceToken);
    if (accepted.includes(body.deviceToken)) return Response.json({ status: 200 });
    return Response.json(
      { error: "apns_refused", status: 400, reason: "BadTopic" },
      { status: 502 },
    );
  };
  return { tokens, send };
}

/** A relay nobody reaches: every push fails in a way a retry may fix. */
const unreachable: Fetch = async () => {
  throw new Error("connection refused");
};

async function deliverTry(event: BrigadeEvent, send: Fetch, attempts: number) {
  const batch = createMessageBatch("brigade-events", [
    { id: "msg-0", timestamp: new Date(), attempts, body: event },
  ]);
  const ctx = createExecutionContext();
  await consumeEvents(batch, relayEnv, send);
  return getQueueResult(batch, ctx);
}

const pushTokenOf = (ws: Workspace, member: Actor) =>
  ws.withShard(
    (shard) => shard.store.scan("devices").find((device) => device.userId === member.id)!.pushToken,
  );

const pagedEvents = async (ws: Workspace, incident: string) =>
  (await ws.events(incident)).filter((e) => e.type === "escalation.paged");

describe("escalating early when every push of a level fails (the paging path's)", () => {
  test("every push of level 1 refused: level 2 is paged now, says why, and its event pages it", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, refusing().send);
    expect(await ws.levels(incident)).toEqual([
      expect.objectContaining({ level: 1, userIds: [caio.id], reason: "started" }),
      expect.objectContaining({ level: 2, userIds: [eva.id], reason: "undelivered" }),
    ]);
    const run = await ws.escalation(incident);
    expect(run).toMatchObject({ status: "running", paged: 2 });
    expect(run!.pages.at(-1)).toMatchObject({ level: 2, unreached: 1 });
    const entries = await ws.timeline(incident);
    // Caio's failed push first, then why level 2 came early.
    expect(entries.filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: caio.id, reason: "undelivered", step: 1 }),
    ]);
    expect(entries.filter((row) => row.kind === "escalated").at(-1)).toMatchObject({
      level: 2,
      reason: "undelivered",
      unreached: 1,
    });
    const alarm = await ws.withShard((_shard, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(run!.nextAt!);
    const second = (await pagedEvents(ws, incident))[1]!;
    const { tokens, send } = relay();
    await deliver(second, send);
    expect(await pagedMembers(ws, tokens)).toEqual([eva.id]);
  });

  test("one device that took the push is enough: the level waits for its timeout", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [
      {
        targets: [
          { kind: "schedule", id: SCHEDULE },
          { kind: "member", id: bia.id },
        ],
      },
      { targets: [{ kind: "member", id: eva.id }] },
    ]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, refusing([await pushTokenOf(ws, bia)]).send);
    expect(await ws.levels(incident)).toHaveLength(1);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running", paged: 1 });
    // Caio's refusal is still recorded.
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: caio.id, reason: "undelivered" }),
    ]);
  });

  test("a push still being retried is not a failure; past the last try it is", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    const first = await deliverTry(event, unreachable, 1);
    expect(first.retryMessages).toHaveLength(1);
    expect(await ws.levels(incident)).toHaveLength(1);
    const last = await deliverTry(event, unreachable, 5);
    expect(last.retryMessages).toHaveLength(0);
    expect((await ws.levels(incident)).map((one) => [one.level, one.reason])).toEqual([
      [1, "started"],
      [2, "undelivered"],
    ]);
  });

  test("a push held back behind a page is pending: no early escalation, and the level's timeout still fires", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [
      { targets: [{ kind: "schedule", id: SCHEDULE }] },
      {
        targets: [
          { kind: "member", id: caio.id },
          { kind: "member", id: eva.id },
        ],
      },
      { targets: [{ kind: "member", id: bia.id }] },
    ]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    // APNs takes Caio's page; his phone has not confirmed it.
    await deliver(event, relay().send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" }, false);
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    const second = (await pagedEvents(ws, incident))[1]!;
    // Level 2 at SEV3: Caio's push is held back behind his page, Eva's is refused.
    const refused = refusing();
    await deliver(second, refused.send);
    expect(refused.tokens).toEqual([await pushTokenOf(ws, eva)]);
    expect((await ws.levels(incident)).map((one) => [one.level, one.reason])).toEqual([
      [1, "started"],
      [2, "timeout"],
    ]);
    expect(
      (await ws.timeline(incident))
        .filter((row) => row.kind === "page_failed")
        .map((row) => row.userId),
    ).toEqual([eva.id]);

    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect((await ws.levels(incident)).map((one) => [one.level, one.reason])).toEqual([
      [1, "started"],
      [2, "timeout"],
      [3, "timeout"],
    ]);
  });

  test("results that never arrive leave it to the alarm: the level's timeout still fires the next", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    // The first try fails and is retried; no final result ever comes back.
    await deliverTry(event, unreachable, 1);
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect((await ws.levels(incident)).map((one) => [one.level, one.reason])).toEqual([
      [1, "started"],
      [2, "timeout"],
    ]);
  });

  test("a redelivered or dead-lettered result never advances twice", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 2);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, refusing().send);
    expect(await ws.levels(incident)).toHaveLength(2);
    await deliver(event, refusing().send);
    expect(await deadLetter(event)).toMatchObject({ explicitAcks: ["dlq-0"] });
    expect(await ws.levels(incident)).toHaveLength(2);
    // The same result recorded again straight to the shard (a consumer retrying its RPC): still once.
    await ws.stub.recordPage(event, [], true, []);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running", paged: 2 });
    // A dead-lettered level page is paged again, never escalated past: its pushes may have gone out.
    const second = (await pagedEvents(ws, incident))[1]!;
    await deadLetter(second);
    expect((await ws.levels(incident)).map((one) => one.level)).toEqual([1, 2, 2]);
  });

  test("an acknowledgement in between stops it", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    const plan = await ws.stub.planPage(event);
    expect(plan.send).toBe(true);
    if (!plan.send) return;
    await ws.run(eva, "incident.ack", { id: incident }, false);
    await ws.stub.recordPage(
      event,
      plan.targets.map((target) => ({
        deviceId: target.deviceId,
        userId: target.userId,
        ok: false as const,
        reason: "undelivered" as const,
        error: "apns_refused" as const,
      })),
      true,
      plan.skipped,
    );
    expect(await ws.levels(incident)).toHaveLength(1);
    expect(await ws.escalation(incident)).toMatchObject({ status: "acknowledged" });
  });

  test("whoever declared it is on the level and counts as reached: no early escalation", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws, [
      {
        targets: [
          { kind: "schedule", id: SCHEDULE },
          { kind: "member", id: eva.id },
        ],
      },
      { targets: [{ kind: "member", id: bia.id }] },
    ]);
    const { event, incident } = await ws.declare(caio);
    await deliver(event, refusing().send);
    expect(await ws.levels(incident)).toHaveLength(1);
  });

  test("a severity raise paging the level again that fails does not escalate early", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev3");
    await deliver(event, relay().send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" }, false);
    const raised = (await ws.events(incident)).find((e) => e.type === "incident.severity_changed")!;
    await deliver(raised, refusing().send);
    expect(await ws.levels(incident)).toHaveLength(1);
  });

  test("a severity raise a device took counts for its level, even without its delivery rows", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR, "sev3");
    const plan = await ws.stub.planPage(event);
    expect(plan.send).toBe(true);
    if (!plan.send) return;
    // Level 1 paged again by a raise, which Caio's phone took; its delivery rows were never written.
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" }, false);
    const raised = (await ws.events(incident)).find((e) => e.type === "incident.severity_changed")!;
    const { tokens, send } = relay();
    await deliver(raised, send);
    expect(await pagedMembers(ws, tokens)).toEqual([caio.id]);
    await ws.withShard((shard) => {
      for (const row of shard.store.scan("deliveries")) shard.store.delete("deliveries", row.id);
    });
    // Then level 1's own page settles with every push refused: Caio was reached all the same.
    await ws.stub.recordPage(
      event,
      plan.targets.map((target) => ({
        deviceId: target.deviceId,
        userId: target.userId,
        ok: false as const,
        reason: "undelivered" as const,
        error: "apns_refused" as const,
      })),
      true,
      plan.skipped,
    );
    expect(await ws.levels(incident)).toHaveLength(1);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running", paged: 1 });
  });

  test("a level whose only device APNs dropped plans nobody on its retry, and escalates early from there", async () => {
    const ws = await workspace();
    for (const member of [caio, eva]) await ws.device(member);
    await withPolicy(ws);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    const gone: Fetch = async () =>
      Response.json(
        { error: "apns_refused", status: 410, reason: "Unregistered" },
        { status: 502 },
      );
    // The token is gone: the device is dropped and the page retried, so nothing is final yet.
    const first = await deliverTry(event, gone, 1);
    expect(first.retryMessages).toHaveLength(1);
    expect(await ws.levels(incident)).toHaveLength(1);
    expect(
      await ws.withShard((shard) =>
        shard.store.scan("devices").filter((device) => device.userId === caio.id),
      ),
    ).toEqual([]);
    // The retry finds Caio with no device left: nobody to send to, so level 2 now.
    const { tokens, send } = relay();
    const retry = await deliverTry(event, send, 2);
    expect(retry.retryMessages).toHaveLength(0);
    expect(tokens).toEqual([]);
    expect((await ws.levels(incident)).map((one) => [one.level, one.reason])).toEqual([
      [1, "started"],
      [2, "undelivered"],
    ]);
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ userId: caio.id, reason: "token_invalid", step: 1 }),
    ]);
  });

  test("never past the round: the last level failing waits for its timeout, which repeats, then ends", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, undefined, 1);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    // A relay that refuses everything: level 1 escalates early to level 2, in the same round.
    await deliver(event, refusing().send);
    let paged = await pagedEvents(ws, incident);
    expect(paged.map((e) => e.data)).toEqual([
      expect.objectContaining({ level: 1, round: 0 }),
      expect.objectContaining({ level: 2, round: 0, reason: "undelivered" }),
    ]);
    // Level 2 refused too: the run keeps level 2's timeout instead of starting round 2 (or ending) at once.
    const before = await ws.escalation(incident);
    await deliver(paged[1]!, refusing().send);
    expect(await ws.escalation(incident)).toEqual(before);
    expect(before).toMatchObject({ status: "running", paged: 2 });
    expect(before!.nextAt! - before!.pages.at(-1)!.at).toBe(5 * MINUTE);
    expect(
      await ws.withShard((shard) => shard.store.get("escalation_timers", incident)),
    ).toMatchObject({ at: before!.nextAt });
    // Its timeout starts round 2; the same again there.
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    paged = await pagedEvents(ws, incident);
    expect(paged[2]!.data).toMatchObject({ level: 1, round: 1, reason: "timeout" });
    await deliver(paged[2]!, refusing().send);
    paged = await pagedEvents(ws, incident);
    expect(paged[3]!.data).toMatchObject({ level: 2, round: 1, reason: "undelivered" });
    await deliver(paged[3]!, refusing().send);
    expect(await ws.escalation(incident)).toMatchObject({ status: "running", paged: 4 });
    expect((await ws.events(incident)).map((e) => e.type)).not.toContain("escalation.exhausted");
    // Only the last timeout ends the run: everyone who can respond, once.
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect(await ws.escalation(incident)).toMatchObject({ status: "exhausted", nextAt: null });
    expect((await ws.events(incident)).map((e) => e.type)).toContain("escalation.exhausted");
    expect(await ws.withShard((shard) => shard.store.scan("escalation_timers"))).toEqual([]);
    const end = (await pagedEvents(ws, incident))[4]!;
    expect(end.data).toMatchObject({ level: null, round: 1, reason: "exhausted" });
    const { tokens, send } = relay();
    await deliver(end, send);
    // Everyone who can respond with a device, the commander not asked first; the monitor caused it.
    expect(await pagedMembers(ws, tokens)).toEqual([bia.id, caio.id, eva.id]);
  });

  test("the end page failing too changes nothing more: the run already ended", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(ws, [{ targets: [{ kind: "member", id: eva.id }] }]);
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    await deliver(event, refusing().send);
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    const ended = await ws.escalation(incident);
    expect(ended).toMatchObject({ status: "exhausted" });
    const events = await ws.events(incident);
    expect(events.filter((e) => e.type === "escalation.paged")).toHaveLength(2);
    const end = (await pagedEvents(ws, incident)).at(-1)!;
    expect(end.data).toMatchObject({ level: null });
    await deliver(end, refusing().send);
    // The row, its timer and the outbox are as the end left them, save the end page's failures.
    expect(await ws.escalation(incident)).toEqual(ended);
    const escalations = (list: BrigadeEvent[]) =>
      list.filter((e) => e.type.startsWith("escalation."));
    expect(escalations(await ws.events(incident))).toEqual(escalations(events));
    expect(await ws.withShard((shard) => shard.store.scan("escalation_timers"))).toEqual([]);
  });

  test("a relay nobody reaches: each level of the round is paged when the one before gives up, on its own clock", async () => {
    const ws = await workspace();
    for (const member of [bia, caio, eva]) await ws.device(member);
    await withPolicy(
      ws,
      [
        { targets: [{ kind: "schedule", id: SCHEDULE }], timeoutMinutes: 5 },
        { targets: [{ kind: "member", id: eva.id }], timeoutMinutes: 10 },
        { targets: [{ kind: "member", id: bia.id }], timeoutMinutes: 15 },
      ],
      1,
    );
    const { event, incident } = await ws.declare(MONITOR_ACTOR);
    // Retried while attempts remain: level 1 keeps its own timeout meanwhile.
    expect((await deliverTry(event, unreachable, 1)).retryMessages).toHaveLength(1);
    const started = await ws.escalation(incident);
    expect(started).toMatchObject({ paged: 1 });
    expect(started!.nextAt! - started!.startedAt).toBe(5 * MINUTE);
    // Its last try: level 2 now, on level 2's timeout from now.
    expect((await deliverTry(event, unreachable, 5)).retryMessages).toHaveLength(0);
    const second = await ws.escalation(incident);
    expect(second!.pages.at(-1)).toMatchObject({ level: 2, round: 0, reason: "undelivered" });
    expect(second!.nextAt! - second!.pages.at(-1)!.at).toBe(10 * MINUTE);
    // Level 2 gives up too: level 3, on its own 15 minutes.
    const paged = await pagedEvents(ws, incident);
    await deliverTry(paged[1]!, unreachable, 5);
    const third = await ws.escalation(incident);
    expect(third!.pages.at(-1)).toMatchObject({
      level: 3,
      round: 0,
      reason: "undelivered",
      unreached: 2,
    });
    expect(third!.nextAt! - third!.pages.at(-1)!.at).toBe(15 * MINUTE);
    // Level 3, the round's last, gives up: nothing moves until its timeout.
    await deliverTry((await pagedEvents(ws, incident))[2]!, unreachable, 5);
    expect(await ws.escalation(incident)).toEqual(third);
    await ws.due(incident);
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
    expect((await ws.escalation(incident))!.pages.at(-1)).toMatchObject({
      level: 1,
      round: 1,
      reason: "timeout",
    });
  });
});
