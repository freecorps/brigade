// Postmortem drafts with Workers AI and exports to R2 (RFC 0013): who may ask, what the model reads (never an
// address or a device), the draft written through a mutation off the request path, and export files that only owners
// and admins write and read back, which expire.
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { EXPORT_TTL_MS, newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import { exportKey, sweepExports } from "../src/exports.ts";
import { workerAuth } from "../src/index.ts";
import { Shard } from "../src/shard.ts";
import {
  cleanSection,
  draftSource,
  parseDraft,
  requestDraftRoute,
  type AiBinding,
} from "../src/postmortem.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

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
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      name,
      email: `${name.toLowerCase()}-p${++people}@example.com`,
      password: PASSWORD,
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
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
    expect(await features.json()).toEqual({ ai: false, exports: true });
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
    expect(cleanSection(`Line one\r\nLine​ two${String.fromCharCode(0x202e)}`)).toBe(
      "Line one\nLine two",
    );
    expect(cleanSection("x".repeat(5000))).toHaveLength(2999);
    expect(parseDraft({ response: "```json\n" + JSON.stringify(answer) + "\n```" })).toMatchObject({
      summary: answer.summary,
    });
    expect(parseDraft({ response: answer })).toMatchObject({ impact: answer.impact });
    expect(parseDraft({ response: "{}" })).toBeUndefined();
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
    await bucket.put(old, "{}", { customMetadata: { expiresAt: String(Date.now() - 1) } });
    expect(await sweepExports(bucket, Date.now())).toBeGreaterThanOrEqual(1);
    expect(await bucket.head(old)).toBeNull();
    expect(await bucket.head(fresh)).not.toBeNull();
  });
});
