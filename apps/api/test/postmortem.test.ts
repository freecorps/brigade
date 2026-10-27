// Postmortem drafts with Workers AI and exports to R2 (RFC 0013): who may ask, what the model reads (never an
// address or a device), the draft written through a mutation off the request path, and export files that only owners
// and admins write and read back, which expire.
import { env, exports } from "cloudflare:workers";
import { createScheduledController, runInDurableObject } from "cloudflare:test";
import {
  createMemoryStore,
  EXPORT_TTL_MS,
  EXPORTS_PER_HOUR,
  MAX_EXPORT_BYTES,
  newId,
  type Actor,
  type BrigadeTables,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import { describe, expect, test, vi } from "vite-plus/test";
import { exportKey, sweepExports } from "../src/exports.ts";
import worker, { workerAuth } from "../src/index.ts";
import { Shard } from "../src/shard.ts";
import {
  cleanSection,
  draftSource,
  MAX_SOURCE_CHARS,
  parseDraft,
  requestDraftRoute,
  type AiBinding,
} from "../src/postmortem.ts";
import type { WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const INC = "inc_01JB0000000000000000000001";

let people = 0;
let clients = 0;
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 11}`;

const api = (
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  });

type Person = { id: string; cookie: string };

async function signUp(name: string): Promise<Person> {
  const email = `${name.toLowerCase()}-p${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      name,
      email,
      password: PASSWORD,
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = await sessionCookie(email, PASSWORD);
  return { id: body.user.id, cookie };
}

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

/** Ana owns a workspace with one incident; Caio is a responder, Duda a viewer, Eva an outsider. */
async function team() {
  const [ana, caio, duda, eva] = await Promise.all(
    ["Ana", "Caio", "Duda", "Eva"].map((name) => signUp(name)),
  );
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: ana!.cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  await addMember(id, caio!.id, "responder");
  await addMember(id, duda!.id, "viewer");
  const stub = env.WORKSPACE.getByName(id);
  const withShard = <R>(fn: (shard: Shard) => R) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} })),
    );
  const run = (name: string, args: unknown, actor: Actor) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: newId("mut", Date.now(), random),
        actor,
        name,
        args,
        now: Date.now(),
        internal: true,
      });
      return result;
    });
  const owner: Actor = { kind: "user", id: ana!.id, role: "owner" };
  // Members as the shard knows them, with names; Caio's address must never reach the model.
  const caioActor: Actor = { kind: "user", id: caio!.id, role: "responder" };
  const results = [
    await run("member.sync", { id: caio!.id, name: "Caio", role: "responder" }, caioActor),
    await run("incident.declare", { id: INC, title: "Checkout down", severity: "sev1" }, owner),
    await run("incident.postUpdate", { id: INC, body: "Rolled back the payment gateway." }, owner),
    await run("incident.assignRole", { id: INC, role: "commander", userId: caio!.id }, owner),
  ];
  for (const result of results) expect(result).toMatchObject({ ok: true });
  return { id, stub, ana: ana!, caio: caio!, duda: duda!, eva: eva!, withShard, run };
}

type Team = Awaited<ReturnType<typeof team>>;

/** Runs the draft route with a fake model, and waits for what it left in `waitUntil`. */
async function draft(
  t: Team,
  by: Person,
  ai: AiBinding | undefined,
  body: unknown = { locale: "pt-BR" },
) {
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise) };
  const request = new Request(`${ORIGIN}/workspaces/${t.id}/incidents/${INC}/postmortem/draft`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: by.cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await requestDraftRoute(
    request,
    { ...env, ...(ai && { AI: ai }) },
    ctx,
    () => workerAuth(env, ctx, request),
    t.id,
    INC,
  );
  await Promise.all(waits);
  return response;
}

const answer = {
  summary: "O checkout ficou fora do ar.",
  impact: "Pagamentos com cartão.",
  timeline: "12:00 declarado",
  rootCause: "A definir.",
  wentWell: "Rollback rápido.",
  wentPoorly: "Alerta tardio.",
  followUps: "- Orçamento de retentativas",
};

describe("drafting a postmortem with Workers AI", () => {
  test("without the AI binding the route answers 503, and the dashboard hides the button", async () => {
    const t = await team();
    expect((await draft(t, t.caio, undefined)).status).toBe(503);
    const features = await api("/features", { headers: { Cookie: t.caio.cookie } });
    expect(await features.json()).toEqual({
      ai: false,
      exports: true,
      // RFC 0007 "Limits": no MAX_MONITORS in the tests, so the default.
      maxMonitors: 100,
    });
    expect((await api("/features")).status).toBe(401);
  });

  test("a responder's request writes the model's draft through a mutation, marked as AI", async () => {
    const t = await team();
    const seen: unknown[] = [];
    const ai: AiBinding = {
      run: async (_model, inputs) => {
        seen.push(inputs);
        return { response: JSON.stringify(answer) };
      },
    };
    const response = await draft(t, t.caio, ai);
    expect(response.status).toBe(202);
    const row = await t.withShard((shard) => shard.store.get("postmortems", INC));
    expect(row).toMatchObject({
      revision: 1,
      draft: null,
      ai: { by: t.caio.id },
      sections: { summary: "O checkout ficou fora do ar." },
    });
    // What the model read: names and the update, in the asked language; no address.
    const text = JSON.stringify(seen);
    expect(text).toContain("Brazilian Portuguese");
    expect(text).toContain("Rolled back the payment gateway.");
    expect(text).toContain("Caio");
    expect(text).not.toContain("@example.com");
    const events = await t.withShard((shard) =>
      shard.store.scan("timeline").filter((entry) => entry.kind === "postmortem"),
    );
    expect(events).toMatchObject([{ change: "ai_drafted", actor: "sys_ai" }]);
  });

  test("a model that fails or answers nothing usable leaves a failed draft", async () => {
    const t = await team();
    await draft(t, t.caio, { run: async () => ({ response: "I cannot help." }) });
    expect(await t.withShard((shard) => shard.store.get("postmortems", INC)!.draft)).toMatchObject({
      status: "failed",
      reason: "failed",
    });
    await draft(t, t.caio, {
      run: async () => {
        throw new Error("3040: capacity");
      },
    });
    expect(await t.withShard((shard) => shard.store.get("postmortems", INC)!.draft)).toMatchObject({
      status: "failed",
    });
  });

  test("viewers and outsiders cannot ask; a second request while one runs is a conflict", async () => {
    const t = await team();
    const never: AiBinding = { run: () => new Promise(() => {}) };
    expect((await draft(t, t.duda, never)).status).toBe(403);
    expect((await draft(t, t.eva, never)).status).toBe(403);
    // A pending draft (the model never answering is the timeout's job; here it is marked by hand).
    await t.run(
      "postmortem.requestDraft",
      { id: INC, requestId: newId("drf", Date.now(), random) },
      { kind: "user", id: t.caio.id, role: "responder" },
    );
    expect((await draft(t, t.caio, never)).status).toBe(409);
  });

  test("the model's text is cleaned of hidden characters and cut to the cap", () => {
    expect(
      cleanSection(
        `Line one\r\nLine${String.fromCharCode(0x200b)} two${String.fromCharCode(0x202e)}`,
      ),
    ).toBe("Line one\nLine two");
    expect(cleanSection("x".repeat(5000))).toHaveLength(2999);
    expect(parseDraft({ response: "```json\n" + JSON.stringify(answer) + "\n```" })).toMatchObject({
      summary: answer.summary,
    });
    expect(parseDraft({ response: answer })).toMatchObject({ impact: answer.impact });
    expect(parseDraft({ response: "{}" })).toBeUndefined();
  });

  test("a timeline of 10,000 entries is cut to fit, measuring the whole source at most twice", () => {
    const store = createMemoryStore<BrigadeTables>();
    const at = Date.UTC(2026, 9, 26, 12);
    const entries = 10_000;
    store.insert("incidents", {
      id: INC,
      number: 1,
      title: "Checkout down",
      severity: "sev1",
      status: "investigating",
      declaredAt: at,
      updatedAt: at,
      timelineSeq: entries,
    } as BrigadeTables["incidents"]);
    for (let seq = 1; seq <= entries; seq++) {
      store.insert("timeline", {
        id: `${INC}:${seq}`,
        incidentId: INC,
        seq,
        at: at + seq * 1000,
        actor: "sys_monitors",
        kind: "update",
        body: `Update number ${seq}: ${"still looking into it. ".repeat(4)}`,
      } as TimelineRow);
    }
    const stringify = vi.spyOn(JSON, "stringify");
    const source = draftSource(store, INC, "en")!;
    // The whole source is measured once (plus once for the room it leaves), not once per entry dropped.
    const wholes = stringify.mock.calls.filter(
      ([value]) => typeof value === "object" && value !== null && "omitted" in value,
    ).length;
    stringify.mockRestore();
    // No wall-clock bound: CI machines vary too much. Counting whole-source serializations is what proves it linear.
    expect(wholes).toBeLessThanOrEqual(2);
    expect(JSON.stringify(source).length).toBeLessThanOrEqual(MAX_SOURCE_CHARS);
    // The start, then the end, the middle left out.
    expect(source.timeline[0]!.what).toContain("Update number 1:");
    expect(source.timeline[9]!.what).toContain("Update number 10:");
    expect(source.timeline[10]!.what).not.toContain("Update number 11:");
    expect(source.timeline.at(-1)!.what).toContain(`Update number ${entries}:`);
    expect(source.omitted + source.timeline.length).toBe(entries);
  });

  test("an incident the shard does not have leaves no pending draft and uses no slot", async () => {
    const t = await team();
    const ai: AiBinding = { run: async () => ({ response: JSON.stringify(answer) }) };
    const waits: Promise<unknown>[] = [];
    const missing = "inc_01JB0000000000000000000009";
    const request = new Request(
      `${ORIGIN}/workspaces/${t.id}/incidents/${missing}/postmortem/draft`,
      {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: t.caio.cookie, "Content-Type": "application/json" },
        body: "{}",
      },
    );
    const ctx = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise) };
    const response = await requestDraftRoute(
      request,
      { ...env, AI: ai },
      ctx,
      () => workerAuth(env, ctx, request),
      t.id,
      missing,
    );
    expect(response.status).toBe(404);
    expect(waits).toHaveLength(0);
    const left = await t.withShard((shard) => ({
      postmortems: shard.store.scan("postmortems"),
      ledger: shard.store.scan("ai_drafts"),
    }));
    expect(left).toEqual({ postmortems: [], ledger: [] });
  });

  test("entries about pages and emails never reach the model", async () => {
    const t = await team();
    await t.run(
      "notification.fail",
      {
        incidentId: INC,
        eventId: newId("evt", Date.now(), random),
        userId: t.caio.id,
        reason: "no_devices",
      },
      { kind: "system", id: "sys_notifier", role: "admin" },
    );
    const source = await t.withShard((shard) => draftSource(shard.store, INC, "en"));
    expect(JSON.stringify(source)).not.toContain("no_devices");
    expect(source!.timeline.map((entry) => entry.what)).toContain("made Caio commander");
  });
});

describe("exports", () => {
  const create = (t: Team, by: Person, scope: unknown) =>
    api(`/workspaces/${t.id}/exports`, {
      method: "POST",
      headers: { Cookie: by.cookie },
      body: JSON.stringify({ scope }),
    });

  test("an owner exports an incident to R2 and downloads it; the export is listed and an event", async () => {
    const t = await team();
    const created = await create(t, t.ana, { kind: "incident", incidentId: INC });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const stored = await env.EXPORTS!.head(exportKey(t.id, id));
    expect(stored).not.toBeNull();
    const download = await api(`/workspaces/${t.id}/exports/${id}`, {
      headers: { Cookie: t.ana.cookie },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Disposition")).toContain("attachment");
    const file = (await download.json()) as { format: string; incidents: { updates: unknown[] }[] };
    expect(file.format).toBe("brigade.export");
    expect(file.incidents[0]!.updates).toHaveLength(1);
    const listed = await t.withShard((shard) => shard.store.scan("exports"));
    expect(listed).toMatchObject([{ id, incidents: 1 }]);
    const events = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      state.storage.sql.exec<{ event: string }>("select event from outbox").toArray(),
    );
    expect(events.map((row) => (JSON.parse(row.event) as { type: string }).type)).toContain(
      "workspace.exported",
    );
  });

  test("a date range; responders, viewers and outsiders can neither export nor download", async () => {
    const t = await team();
    const today = new Date().toISOString().slice(0, 10);
    const created = await create(t, t.ana, { kind: "range", from: today, to: today });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    for (const who of [t.caio, t.duda, t.eva]) {
      expect((await create(t, who, { kind: "range", from: today, to: today })).status).toBe(403);
      const download = await api(`/workspaces/${t.id}/exports/${id}`, {
        headers: { Cookie: who.cookie },
      });
      expect(download.status).toBe(403);
    }
    expect((await create(t, t.ana, { kind: "range", from: today, to: "1999-01-01" })).status).toBe(
      400,
    );
    expect(
      (await create(t, t.ana, { kind: "incident", incidentId: "inc_01JB0000000000000000000009" }))
        .status,
    ).toBe(404);
    // Another workspace's export is not found under this one's prefix.
    const other = await api(`/workspaces/${t.id}/exports/exp_01JB0000000000000000000001`, {
      headers: { Cookie: t.ana.cookie },
    });
    expect(other.status).toBe(404);
  });

  test("an export made in another workspace is not found through this one's route", async () => {
    const a = await team();
    const b = await team();
    const created = await create(b, b.ana, { kind: "incident", incidentId: INC });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    // B's owner reads it through B; A's owner gets a 404 through A, even knowing the id.
    expect(
      (await api(`/workspaces/${b.id}/exports/${id}`, { headers: { Cookie: b.ana.cookie } }))
        .status,
    ).toBe(200);
    expect(
      (await api(`/workspaces/${a.id}/exports/${id}`, { headers: { Cookie: a.ana.cookie } }))
        .status,
    ).toBe(404);
    // And A's owner is no member of B.
    expect(
      (await api(`/workspaces/${b.id}/exports/${id}`, { headers: { Cookie: a.ana.cookie } }))
        .status,
    ).toBe(403);
  });

  test(`at most ${EXPORTS_PER_HOUR} exports an hour per workspace`, async () => {
    const t = await team();
    const scope = { kind: "incident", incidentId: INC };
    for (let index = 0; index < EXPORTS_PER_HOUR; index++) {
      expect((await create(t, t.ana, scope)).status).toBe(201);
    }
    const refused = await create(t, t.ana, scope);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "rate_limited" });
    // Server-only: the ledger never syncs.
    expect(await t.withShard((shard) => shard.store.scan("export_ledger").length)).toBe(
      EXPORTS_PER_HOUR,
    );
  });

  test("a file over the cap is refused before it is written, without building it whole", async () => {
    const t = await team();
    // Updates of 4,000 characters (the most one holds), in enough incidents to pass 25 MiB.
    const body = "x".repeat(4000);
    const owner: Actor = { kind: "user", id: t.ana.id, role: "owner" };
    const perIncident = 900;
    const incidents = Math.ceil(MAX_EXPORT_BYTES / (perIncident * body.length)) + 1;
    for (let index = 0; index < incidents; index++) {
      const id = `inc_01JK${String(index).padStart(22, "0")}`;
      expect(await t.run("incident.declare", { id, title: `Load ${index}` }, owner)).toMatchObject({
        ok: true,
      });
      // Written straight into the rows: a mutation per update would make the test slow, not the export.
      await t.withShard((shard) => {
        const at = Date.now();
        for (let seq = 2; seq < perIncident + 2; seq++) {
          shard.store.insert("timeline", {
            id: `${id}:${seq}`,
            incidentId: id,
            seq,
            at,
            actor: t.ana.id,
            kind: "update",
            body,
          } as TimelineRow);
        }
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const refused = await create(t, t.ana, { kind: "range", from: today, to: today });
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({ error: "too_large" });
    const listed = await env.EXPORTS!.list({ prefix: `workspaces/${t.id}/` });
    expect(listed.objects).toHaveLength(0);
  });

  test("an expired export is refused and deleted; the sweep deletes the rest", async () => {
    const t = await team();
    const bucket = env.EXPORTS!;
    const old = exportKey(t.id, "exp_01JB0000000000000000000002");
    const fresh = exportKey(t.id, "exp_01JB0000000000000000000003");
    await bucket.put(old, "{}", { customMetadata: { expiresAt: String(Date.now() - 1) } });
    await bucket.put(fresh, "{}", {
      customMetadata: { expiresAt: String(Date.now() + EXPORT_TTL_MS) },
    });
    const download = await api(`/workspaces/${t.id}/exports/exp_01JB0000000000000000000002`, {
      headers: { Cookie: t.ana.cookie },
    });
    expect(download.status).toBe(410);
    // The sweep goes by when an object was uploaded: none of these is a week old yet.
    expect(await sweepExports(bucket, Date.now())).toBe(0);
    expect(await bucket.head(fresh)).not.toBeNull();
    expect(await sweepExports(bucket, Date.now() + EXPORT_TTL_MS + 1000)).toBeGreaterThanOrEqual(1);
    expect(await bucket.head(fresh)).toBeNull();
  });
});

describe("the cron", () => {
  /** A bucket whose listing fails, and a watchdog that counts beats. */
  function cron(minute: number) {
    const list = vi.fn(async () => {
      throw new Error("R2 is down");
    });
    const beat = vi.fn(async () => {});
    const waits: Promise<unknown>[] = [];
    const scheduled = worker.scheduled!(
      createScheduledController({
        scheduledTime: new Date(Date.UTC(2026, 9, 26, 12, minute)),
        cron: "* * * * *",
      }),
      {
        ...env,
        EXPORTS: { list } as unknown as R2Bucket,
        WATCHDOG: { getByName: () => ({ beat }) } as unknown as typeof env.WATCHDOG,
      },
      { waitUntil: (promise: Promise<unknown>) => void waits.push(promise) } as ExecutionContext,
    );
    return { list, beat, done: async () => (await scheduled, await Promise.all(waits)) };
  }

  test("sweeps exports only at minute 17, and a failing sweep never stops the heartbeat", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const at17 = cron(17);
    await at17.done();
    expect(at17.list).toHaveBeenCalledTimes(1);
    expect(at17.beat).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.flat().join(" ")).toContain("export sweep failed");
    for (const minute of [0, 16, 18, 59]) {
      const other = cron(minute);
      await other.done();
      expect(other.list).not.toHaveBeenCalled();
      expect(other.beat).toHaveBeenCalledTimes(1);
    }
    errors.mockRestore();
  });

  test("the sweep pages through the bucket with its cursor", async () => {
    const old = new Date(Date.now() - EXPORT_TTL_MS - 1000);
    const pages = [
      {
        objects: [{ key: "workspaces/a/exports/1.json", uploaded: old }],
        truncated: true,
        cursor: "c1",
      },
      {
        objects: [{ key: "workspaces/b/exports/2.json", uploaded: new Date() }],
        truncated: true,
        cursor: "c2",
      },
      { objects: [{ key: "workspaces/c/exports/3.json", uploaded: old }], truncated: false },
    ];
    const seen: (string | undefined)[] = [];
    const deleted: string[] = [];
    const bucket = {
      list: async (options: R2ListOptions) => {
        expect(options.include).toBeUndefined();
        seen.push(options.cursor);
        return pages[seen.length - 1];
      },
      delete: async (keys: string[]) => void deleted.push(...keys),
    } as unknown as R2Bucket;
    expect(await sweepExports(bucket, Date.now())).toBe(2);
    expect(seen).toEqual([undefined, "c1", "c2"]);
    expect(deleted).toEqual(["workspaces/a/exports/1.json", "workspaces/c/exports/3.json"]);
  });
});
