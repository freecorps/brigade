// Monitoring end to end (RFC 0007), a paging path: the HTTP check and its target rules, ProbeDO's alarm chain,
// probe reports turning into an alert and an incident on the workspace shard, and heartbeats.
import { env, exports } from "cloudflare:workers";
import { listDurableObjectIds, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, test, vi } from "vite-plus/test";
import {
  heartbeatToken,
  newHeartbeatSecret,
  newId,
  REPORT_EVERY_MS,
  staleAfterMs,
  type Actor,
  type ProbeRegion,
} from "@freecorps/brigade-schema";
import { httpCheck, MAX_BODY_BYTES, type HttpCheckConfig } from "../src/check.ts";
import { receiveHeartbeat } from "../src/index.ts";
import { probeName, type ProbeDO, type ProbeReport } from "../src/probe.ts";
import { Shard } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const admin: Actor = { kind: "user", id: "usr_ana", role: "admin" };

const config = (overrides: Partial<HttpCheckConfig> = {}): HttpCheckConfig => ({
  id: newId("mon", Date.now(), random),
  url: "https://example.com/health",
  method: "GET",
  expectedStatus: null,
  keyword: null,
  intervalSeconds: 60,
  timeoutSeconds: 5,
  ...overrides,
});

/** A fetcher that answers the trace with `colo` and every check with `answer()`. */
function fakeFetch(colo: string, answer: () => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    if (url.endsWith("/cdn-cgi/trace")) return new Response(`fl=1\ncolo=${colo}\nloc=US\n`);
    return answer();
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("httpCheck", () => {
  test("refuses a private target without fetching it", async () => {
    const { fetcher, calls } = fakeFetch("CDG", () => new Response("ok"));
    for (const url of ["http://169.254.169.254/", "http://localhost/", "file:///etc/passwd"]) {
      expect(await httpCheck(fetcher, config({ url }))).toEqual({
        ok: false,
        latencyMs: null,
        httpStatus: null,
        error: "blocked",
      });
    }
    expect(calls).toEqual([]);
  });

  test("never follows redirects: a 3xx is the answer, up unless another status is expected", async () => {
    const redirect = () =>
      new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/" } });
    const { fetcher, calls } = fakeFetch("CDG", redirect);
    expect(await httpCheck(fetcher, config())).toMatchObject({ ok: true, httpStatus: 302 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init).toMatchObject({ redirect: "manual", method: "GET" });
    expect(await httpCheck(fetcher, config({ expectedStatus: 200 }))).toMatchObject({
      ok: false,
      error: "status",
    });
  });

  test("statuses, keywords, timeouts and network errors", async () => {
    const status = (code: number) =>
      fakeFetch("CDG", () => new Response(code === 204 ? null : "x", { status: code }));
    expect(await httpCheck(status(503).fetcher, config())).toMatchObject({
      ok: false,
      httpStatus: 503,
      error: "status",
    });
    expect(await httpCheck(status(204).fetcher, config({ expectedStatus: 204 }))).toMatchObject({
      ok: true,
      error: null,
    });
    const body = fakeFetch("CDG", () => new Response("<p>all systems normal</p>"));
    expect(await httpCheck(body.fetcher, config({ keyword: "normal" }))).toMatchObject({
      ok: true,
    });
    expect(await httpCheck(body.fetcher, config({ keyword: "degraded" }))).toMatchObject({
      ok: false,
      error: "keyword",
    });

    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
      )) as typeof fetch;
    expect(await httpCheck(hang, config({ timeoutSeconds: 1 }))).toMatchObject({
      ok: false,
      error: "timeout",
    });
    const broken = (async () => {
      throw new TypeError("connection refused");
    }) as typeof fetch;
    expect(await httpCheck(broken, config())).toMatchObject({ ok: false, error: "network" });
  });

  test("reads at most MAX_BODY_BYTES of a body looking for the keyword", async () => {
    let pulled = 0;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1024;
            controller.enqueue(new TextEncoder().encode("a".repeat(1024)));
          },
        }),
      );
    const { fetcher } = fakeFetch("CDG", endless);
    expect(await httpCheck(fetcher, config({ keyword: "needle" }))).toMatchObject({
      ok: false,
      error: "keyword",
    });
    expect(pulled).toBeLessThan(MAX_BODY_BYTES + 64 * 1024);
  });
});

let names = 0;

/** A provisioned workspace shard, and a way to run code against its storage. */
async function workspace() {
  // A real workspace id: `workspace.create` takes only those.
  const id = newId("ws", Date.now() + ++names, random);
  // The organization Better Auth would have written: heartbeats look the workspace up in D1.
  await env.DB.prepare(
    'insert into "organization" ("id", "name", "slug", "createdAt") values (?, ?, ?, ?)',
  )
    .bind(id, "Acme", `ws-${id}`, new Date().toISOString())
    .run();
  const stub = env.WORKSPACE.getByName(id);
  expect(await stub.provision({ id, name: "Acme" }, { ...admin, role: "owner" })).toEqual({
    ok: true,
  });
  const withShard = <R>(
    fn: (shard: Shard, instance: WorkspaceDO, sql: SqlStorage) => R | Promise<R>,
  ) =>
    runInDurableObject(stub, (instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        instance,
        state.storage.sql,
      ),
    );
  let mutation = 0;
  const run = (name: string, args: object, actor: Actor = admin) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: `m${++mutation}`,
        actor,
        name,
        args,
        now: Date.now(),
      });
      return result;
    });
  return { id, stub, withShard, run };
}

function probe(workspaceId: string, region: ProbeRegion) {
  return env.PROBE.getByName(probeName(workspaceId, region), { locationHint: region });
}

/** Makes every check due and runs the probe's alarm. */
async function runProbe(stub: DurableObjectStub<ProbeDO>) {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("update probe_checks set next_at = 0");
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
}

/** Each outbox event's type and actor, in order. */
const outbox = (sql: SqlStorage) =>
  sql
    .exec<{ event: string }>("select event from outbox order by seq")
    .toArray()
    .map((row) => {
      const event = JSON.parse(row.event) as { type: string; actor: { id: string } };
      return `${event.type} by ${event.actor.id}`;
    });

describe("monitor down → alert → incident", () => {
  test("a failing region fires one alert and opens one incident; recovery resolves the alert", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    const weur = probe(ws.id, "weur");
    let answer = 503;
    const fake = fakeFetch("CDG", () => new Response("down", { status: answer }));
    // Before the shard pushes the config, so the probe's first run already uses the fake.
    await runInDurableObject(weur, (instance: ProbeDO) => {
      instance.fetcher = fake.fetcher;
    });

    const created = await ws.run("monitor.createHttp", {
      id: monitorId,
      name: "Checkout",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 5,
      regions: ["weur"],
    });
    expect(created).toMatchObject({ ok: true });
    // The shard alarm pushes the region's checks to its probe.
    await ws.withShard((_shard, instance) => instance.alarm());
    expect(
      (await runInDurableObject(weur, (instance: ProbeDO) => instance.rows())).map((row) => row.id),
    ).toEqual([monitorId]);

    // Two failures in a row (CONSECUTIVE_CHECKS) make the region down; with one region, that is the quorum.
    for (let run = 0; run < 3; run++) {
      const status = await ws.withShard((shard) => shard.store.get("monitors", monitorId)?.status);
      if (status === "down") break;
      await runProbe(weur);
    }
    await ws.withShard((shard, _instance, sql) => {
      const monitor = shard.store.get("monitors", monitorId)!;
      expect(monitor).toMatchObject({ status: "down", alertId: expect.any(String) });
      expect(monitor.checks).toEqual([
        expect.objectContaining({ source: "weur", up: false, colo: "CDG", httpStatus: 503 }),
      ]);
      const incidents = shard.store.scan("incidents");
      expect(incidents).toEqual([
        expect.objectContaining({
          id: monitor.incidentId,
          title: "Checkout is down",
          severity: "sev2",
          declaredBy: "sys_monitors",
          number: 1,
        }),
      ]);
      expect(shard.store.scan("alerts")).toEqual([
        expect.objectContaining({ status: "firing", incidentId: monitor.incidentId }),
      ]);
      // Every change went through the outbox, the system actor's included (RFC 0005).
      expect(outbox(sql)).toEqual(
        expect.arrayContaining([
          "monitor.created by usr_ana",
          "monitor.checked by sys_monitors",
          "alert.fired by sys_monitors",
          "incident.declared by sys_monitors",
        ]),
      );
    });

    // Still failing: no second alert or incident. The unchanged verdict, re-sent once REPORT_EVERY_MS passed,
    // refreshes the row (its check time) without an outbox event.
    const events = await ws.withShard((_shard, _instance, sql) => outbox(sql).length);
    await runInDurableObject(weur, (_instance, state) => {
      state.storage.sql.exec(
        "update probe_checks set reported_at = ?",
        Date.now() - REPORT_EVERY_MS,
      );
    });
    const before = await ws.withShard(
      (shard) => shard.store.get("monitors", monitorId)!.checks[0]!.at,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await runProbe(weur);
    await ws.withShard((shard, _instance, sql) => {
      expect(shard.store.scan("alerts")).toHaveLength(1);
      expect(shard.store.scan("incidents")).toHaveLength(1);
      expect(shard.store.get("monitors", monitorId)!.checks[0]!.at).toBeGreaterThan(before);
      expect(outbox(sql)).toHaveLength(events);
    });

    answer = 200;
    for (let run = 0; run < 3; run++) {
      const status = await ws.withShard((shard) => shard.store.get("monitors", monitorId)?.status);
      if (status === "up") break;
      await runProbe(weur);
    }
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)).toMatchObject({ status: "up", alertId: null });
      expect(shard.store.scan("alerts")).toEqual([expect.objectContaining({ status: "resolved" })]);
      // The incident is left for people to resolve.
      expect(shard.store.scan("incidents")).toEqual([
        expect.objectContaining({ status: "triage" }),
      ]);
    });

    // Paused: the probe gets an empty list and stops its alarm.
    await ws.run("monitor.setPaused", { id: monitorId, paused: true });
    await ws.withShard((_shard, instance) => instance.alarm());
    expect(await runInDurableObject(weur, (instance: ProbeDO) => instance.rows())).toEqual([]);
    expect(await runInDurableObject(weur, (_i, state) => state.storage.getAlarm())).toBeNull();
  });

  test("a report computed before another region's flip still counts: one incident, no false recovery", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    await ws.run("monitor.createHttp", {
      id: monitorId,
      name: "Checkout",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 5,
      regions: ["wnam", "enam", "weur"],
    });
    const start = Date.now();
    const verdict = (up: boolean, at: number): ProbeReport => ({
      reportId: newId("rep", at, random),
      id: monitorId,
      at,
      up,
      latencyMs: up ? 80 : null,
      colo: "IAD",
      httpStatus: up ? 200 : null,
      error: up ? null : "timeout",
    });
    expect(await ws.stub.report("wnam", [verdict(false, start + 1)])).toEqual([true]);
    expect(await ws.stub.report("enam", [verdict(false, start + 3)])).toEqual([true]);
    // weur checked between the two, but its report arrives after the flip to down.
    const late = verdict(false, start + 2);
    expect(await ws.stub.report("weur", [late])).toEqual([true]);
    // A retry of the same report is answered from the stored result and changes nothing.
    expect(await ws.stub.report("weur", [late])).toEqual([true]);
    expect(await ws.stub.report("wnam", [verdict(true, start + 4)])).toEqual([true]);
    await ws.withShard((shard, _instance, sql) => {
      const monitor = shard.store.get("monitors", monitorId)!;
      expect(monitor.status).toBe("down");
      expect(monitor.checks.map((check) => [check.source, check.up])).toEqual([
        ["wnam", true],
        ["enam", false],
        ["weur", false],
      ]);
      expect(shard.store.scan("incidents")).toHaveLength(1);
      expect(shard.store.scan("alerts")).toEqual([expect.objectContaining({ status: "firing" })]);
      expect(outbox(sql).filter((event) => event.startsWith("monitor.checked"))).toHaveLength(4);
    });
  });

  test("a monitor whose probes stop reporting turns unknown on the shard alarm, not up", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    await ws.run("monitor.createHttp", {
      id: monitorId,
      name: "Checkout",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 5,
      regions: ["weur"],
    });
    const at = Date.now();
    expect(
      await ws.stub.report("weur", [
        {
          reportId: newId("rep", at, random),
          id: monitorId,
          at,
          up: true,
          latencyMs: 80,
          colo: "CDG",
          httpStatus: 200,
          error: null,
        },
      ]),
    ).toEqual([true]);
    // The region's only result is older than the stale window: nothing says the target is up any more.
    await ws.withShard((shard) => {
      const monitor = shard.store.get("monitors", monitorId)!;
      const old = Date.now() - staleAfterMs(monitor) - 1000;
      shard.store.update("monitors", monitorId, {
        checks: monitor.checks.map((check) => ({ ...check, at: old })),
      });
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await ws.withShard((_shard, instance) => instance.alarm());
    } finally {
      error.mockRestore();
    }
    await ws.withShard((shard, _instance, sql) => {
      expect(shard.store.get("monitors", monitorId)?.status).toBe("unknown");
      expect(outbox(sql)).toContain("monitor.status_changed by sys_monitors");
      expect(shard.store.scan("incidents")).toEqual([]);
    });
  });

  test("the shard alarm reschedules itself even when its work fails", async () => {
    const ws = await workspace();
    await ws.run("monitor.createHttp", {
      id: newId("mon", Date.now(), random),
      name: "Checkout",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 5,
      regions: ["weur"],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runInDurableObject(ws.stub, async (instance: WorkspaceDO, state) => {
        await state.storage.deleteAlarm();
        const monitoring = Reflect.get(instance, "monitoring") as object;
        Reflect.set(monitoring, "pushProbes", () => Promise.reject(new Error("push broke")));
        const before = Date.now();
        await instance.alarm();
        expect(await state.storage.getAlarm()).toBeGreaterThanOrEqual(before);
      });
      expect(error).toHaveBeenCalledWith(expect.stringContaining("monitor tick failed"));
    } finally {
      error.mockRestore();
    }
  });

  test("a probe run that throws keeps its alarm chain", async () => {
    const ws = await workspace();
    const stub = probe(ws.id, "eeur");
    const fake = fakeFetch("FRA", () => new Response("ok"));
    await runInDurableObject(stub, (instance: ProbeDO) => {
      instance.fetcher = fake.fetcher;
    });
    await stub.configure(ws.id, "eeur", [config()]);
    // A corrupt row makes the run throw after the alarm was set again.
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("update probe_checks set config = 'not json', next_at = 0");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const before = Date.now();
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      const next = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
      expect(next).toBeGreaterThanOrEqual(before + 25_000);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("probe run failed"));
    } finally {
      error.mockRestore();
    }
  });

  test("a probe refuses another workspace's config, and the shard keeps retrying its push", async () => {
    const ws = await workspace();
    const stub = probe(ws.id, "oc");
    // Claimed by someone else: the push is refused.
    expect(await stub.configure("someone-else", "oc", [])).toEqual({ ok: true });
    expect(await stub.configure(ws.id, "oc", [])).toEqual({ ok: false });
    await ws.run("monitor.createHttp", {
      id: newId("mon", Date.now(), random),
      name: "Sydney",
      url: "https://example.com/",
      method: "HEAD",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 30,
      timeoutSeconds: 5,
      regions: ["oc"],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await ws.withShard((_shard, instance) => instance.alarm());
      expect(error).toHaveBeenCalledWith(expect.stringContaining("probe push failed"));
    } finally {
      error.mockRestore();
    }
    await runInDurableObject(ws.stub, (_instance, state) => {
      expect(
        state.storage.sql.exec("select * from probe_pushes where region = 'oc'").toArray(),
      ).toEqual([]);
      return state.storage.getAlarm().then((alarm) => expect(alarm).not.toBeNull());
    });
  });
});

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("heartbeats", () => {
  test("POST /heartbeat/:token: the right secret only; a missed beat opens an incident", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    const secret = newHeartbeatSecret(random);
    expect(
      await ws.run("monitor.createHeartbeat", {
        id: monitorId,
        name: "Nightly backup",
        intervalSeconds: 60,
        graceSeconds: 30,
        tokenHash: await sha256Hex(secret),
      }),
    ).toMatchObject({ ok: true });

    const ping = (token: string, method = "POST") =>
      exports.default.fetch(`http://localhost/heartbeat/${token}`, { method });
    const wrong = newHeartbeatSecret(random);
    expect((await ping(heartbeatToken(ws.id, monitorId, wrong))).status).toBe(404);
    expect(
      (await ping(heartbeatToken(ws.id, newId("mon", Date.now(), random), secret))).status,
    ).toBe(404);
    expect((await ping("not-a-token")).status).toBe(404);
    expect((await ping(heartbeatToken("monitors-nope", monitorId, secret))).status).toBe(404);
    // A well-formed token for a workspace that does not exist: the same 404, and no Durable Object made for it.
    const madeUp = newId("ws", Date.now(), random);
    const refused = await ping(heartbeatToken(madeUp, monitorId, secret));
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "not_found" });
    const made = await listDurableObjectIds(env.WORKSPACE);
    expect(made.map((id) => id.toString())).not.toContain(
      env.WORKSPACE.idFromName(madeUp).toString(),
    );
    expect((await ping(heartbeatToken(ws.id, monitorId, secret), "GET")).status).toBe(405);
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)?.status).toBe("pending");
    });

    // A lost shard alarm is re-armed by the next accepted ping.
    await runInDurableObject(ws.stub, (_instance, state) => state.storage.deleteAlarm());
    const accepted = await ping(heartbeatToken(ws.id, monitorId, secret));
    expect(accepted.status).toBe(202);
    expect(
      await runInDurableObject(ws.stub, (_i, state) => state.storage.getAlarm()),
    ).not.toBeNull();
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)).toMatchObject({
        status: "up",
        checks: [expect.objectContaining({ source: "heartbeat", up: true })],
      });
      expect(shard.store.get("heartbeats", monitorId)?.lastPingAt).toEqual(expect.any(Number));
    });

    // The last ping and the up result are 2 minutes old: past the interval plus the grace.
    await ws.withShard((shard) => {
      const past = Date.now() - 120_000;
      const monitor = shard.store.get("monitors", monitorId)!;
      shard.store.update("heartbeats", monitorId, { lastPingAt: past });
      shard.store.update("monitors", monitorId, {
        since: past,
        restartedAt: past,
        checks: monitor.checks.map((check) => ({ ...check, at: past })),
      });
    });
    await ws.withShard((_shard, instance) => instance.alarm());
    await ws.withShard((shard) => {
      const monitor = shard.store.get("monitors", monitorId)!;
      expect(monitor).toMatchObject({
        status: "down",
        checks: [expect.objectContaining({ up: false, error: "missed" })],
      });
      expect(shard.store.scan("incidents")).toEqual([
        expect.objectContaining({ id: monitor.incidentId, title: "Nightly backup is down" }),
      ]);
    });

    // A ping recovers it and resolves the alert.
    expect((await ping(heartbeatToken(ws.id, monitorId, secret))).status).toBe(202);
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)).toMatchObject({ status: "up", alertId: null });
      expect(shard.store.scan("alerts")).toEqual([expect.objectContaining({ status: "resolved" })]);
    });
  });

  test("a D1 failure does not drop a real ping: the shard still decides", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    const secret = newHeartbeatSecret(random);
    expect(
      await ws.run("monitor.createHeartbeat", {
        id: monitorId,
        name: "Nightly backup",
        intervalSeconds: 60,
        graceSeconds: 30,
        tokenHash: await sha256Hex(secret),
      }),
    ).toMatchObject({ ok: true });
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: unavailable");
      },
    } as unknown as D1Database;
    const brokenEnv = { ...env, DB: broken };
    const ping = (token: string) =>
      receiveHeartbeat(
        new Request(`http://localhost/heartbeat/${token}`, { method: "POST" }),
        brokenEnv,
        token,
      );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await ping(heartbeatToken(ws.id, monitorId, secret))).status).toBe(202);
      // The shard still checks the secret.
      expect(
        (await ping(heartbeatToken(ws.id, monitorId, newHeartbeatSecret(random)))).status,
      ).toBe(404);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("workspace lookup failed"));
    } finally {
      errors.mockRestore();
    }
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)?.status).toBe("up");
    });
  });
});
