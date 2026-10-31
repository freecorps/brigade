// Monitoring end to end (RFC 0007), a paging path: the HTTP and TCP checks and their target rules, ProbeDO's alarm chain,
// probe reports turning into an alert and an incident on the workspace shard, and heartbeats.
import { env, exports } from "cloudflare:workers";
import { listDurableObjectIds, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, inject, test, vi } from "vite-plus/test";
import {
  heartbeatToken,
  newHeartbeatSecret,
  newId,
  REPORT_EVERY_MS,
  staleAfterMs,
  type Actor,
  type ProbeRegion,
} from "@freecorps/brigade-schema";
import {
  defaultConnector,
  httpCheck,
  MAX_BODY_BYTES,
  tcpCheck,
  type Connector,
  type HttpCheckConfig,
  type TcpCheckConfig,
} from "../src/check.ts";
import { AlertIntake, REROUTE_RETRY_MS } from "../src/alert-intake.ts";
import { receiveHeartbeat } from "../src/index.ts";
import { PROBE_PUSH_TIMEOUT_MS } from "../src/monitors.ts";
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

const tcpConfig = (overrides: Partial<TcpCheckConfig> = {}): TcpCheckConfig => ({
  kind: "tcp",
  id: newId("mon", Date.now(), random),
  host: "db.example.com",
  port: 5432,
  intervalSeconds: 60,
  timeoutSeconds: 5,
  ...overrides,
});

/**
 * A connector whose sockets open, fail or hang as `answer` says, and that counts what was opened and closed. A
 * hanging socket settles only when closed, as a real one does.
 */
function fakeConnect(answer: (address: SocketAddress) => "open" | "hang" | Error) {
  const calls: SocketAddress[] = [];
  let closed = 0;
  const connector: Connector = (address) => {
    calls.push(address);
    const outcome = answer(address);
    let settle!: (error?: Error) => void;
    const opened = new Promise<SocketInfo>((resolve, reject) => {
      settle = (error) => (error ? reject(error) : resolve({}));
    });
    if (outcome === "open") settle();
    else if (outcome instanceof Error) settle(outcome);
    return {
      opened,
      // Rejects with `opened`, as a real socket's does.
      closed: opened.then(() => undefined),
      close: async () => {
        closed++;
        settle(new Error("socket closed"));
      },
    } as unknown as Socket;
  };
  return { connector, calls, closedCount: () => closed };
}

describe("tcpCheck", () => {
  test("up when the connection opens; the socket is closed straight after", async () => {
    const fake = fakeConnect(() => "open");
    expect(await tcpCheck(fake.connector, tcpConfig())).toEqual({
      ok: true,
      latencyMs: expect.any(Number),
      httpStatus: null,
      error: null,
    });
    expect(fake.calls).toEqual([{ hostname: "db.example.com", port: 5432 }]);
    expect(fake.closedCount()).toBe(1);

    // An IPv6 address, stored bare, reaches connect() in brackets.
    await tcpCheck(fake.connector, tcpConfig({ host: "2620:fe::fe", port: 22 }));
    expect(fake.calls.at(-1)).toEqual({ hostname: "[2620:fe::fe]", port: 22 });
  });

  test("refused, failing or timed out: down with its reason, and always closed", async () => {
    const refused = fakeConnect(() => new Error("connection refused"));
    expect(await tcpCheck(refused.connector, tcpConfig())).toEqual({
      ok: false,
      latencyMs: null,
      httpStatus: null,
      error: "network",
    });
    expect(refused.closedCount()).toBe(1);

    const hang = fakeConnect(() => "hang");
    const start = Date.now();
    expect(await tcpCheck(hang.connector, tcpConfig({ timeoutSeconds: 1 }))).toMatchObject({
      ok: false,
      error: "timeout",
    });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(hang.closedCount()).toBe(1);

    const throws: Connector = () => {
      throw new TypeError("proxy request failed, cannot connect to the specified address");
    };
    expect(await tcpCheck(throws, tcpConfig())).toMatchObject({ ok: false, error: "network" });
  });

  test("a real socket through workerd's connect(): a listening port is up, a closed one is down", async () => {
    // The target rules refuse loopback, so the check is configured with a public name and the connector is
    // pointed at the local listener (test/setup/tcp-listener.ts).
    const to =
      (port: number): Connector =>
      () =>
        defaultConnector({ hostname: "127.0.0.1", port });
    expect(await tcpCheck(to(inject("tcpOpenPort")), tcpConfig())).toMatchObject({
      ok: true,
      error: null,
    });
    // Refused at once on a dev machine or a runner (`network`); a firewall that drops loopback makes it `timeout`.
    const closed = await tcpCheck(to(inject("tcpClosedPort")), tcpConfig({ timeoutSeconds: 2 }));
    expect(closed.ok).toBe(false);
    expect(["network", "timeout"]).toContain(closed.error);
  });

  // Skipped on a machine with no IPv6 loopback (test/setup/tcp-listener.ts).
  test.runIf(inject("tcpOpenPortV6") > 0)(
    "a real socket to an IPv6 address: the check passes it to connect() in brackets, which a bare one fails",
    async () => {
      const port = inject("tcpOpenPortV6");
      // A public address, as the target rules require; the connector swaps it for the IPv6 loopback, keeping
      // whatever brackets the check put around it.
      const swap: Connector = (address) =>
        defaultConnector({ hostname: address.hostname.replace("2620:fe::fe", "::1"), port });
      expect(await tcpCheck(swap, tcpConfig({ host: "2620:fe::fe" }))).toMatchObject({
        ok: true,
        error: null,
      });
      // Why the brackets: workerd's connect() does not take an IPv6 address without them.
      const bare: Connector = () => defaultConnector({ hostname: "::1", port });
      expect(await tcpCheck(bare, tcpConfig({ timeoutSeconds: 2 }))).toMatchObject({ ok: false });
    },
  );

  test("refuses a private host or port 25 without connecting", async () => {
    const fake = fakeConnect(() => "open");
    for (const [host, port] of [
      ["169.254.169.254", 80],
      ["localhost", 22],
      ["10.0.0.5", 5432],
      ["fd00::1", 22],
      ["db.example.com", 25],
    ] as const) {
      expect(await tcpCheck(fake.connector, tcpConfig({ host, port }))).toEqual({
        ok: false,
        latencyMs: null,
        httpStatus: null,
        error: "blocked",
      });
    }
    expect(fake.calls).toEqual([]);
  });
});

let names = 0;

/** A provisioned workspace shard, and a way to run code against its storage. */
async function workspace(locale?: "en" | "pt-BR") {
  // A real workspace id: `workspace.create` takes only those.
  const id = newId("ws", Date.now() + ++names, random);
  // The organization Better Auth would have written: heartbeats look the workspace up in D1.
  await env.DB.prepare(
    'insert into "organization" ("id", "name", "slug", "createdAt") values (?, ?, ?, ?)',
  )
    .bind(id, "Acme", `ws-${id}`, new Date().toISOString())
    .run();
  const stub = env.WORKSPACE.getByName(id);
  expect(
    await stub.provision(
      { id, name: "Acme", ...(locale ? { locale } : {}) },
      { ...admin, role: "owner" },
    ),
  ).toEqual({ ok: true });
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

  test("a TCP monitor: the shard pushes its host and port, refused connections open one incident", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    const enam = probe(ws.id, "enam");
    let refusing = true;
    const fake = fakeConnect(() => (refusing ? new Error("connection refused") : "open"));
    const http = fakeFetch("IAD", () => new Response("ok"));
    await runInDurableObject(enam, (instance: ProbeDO) => {
      instance.connector = fake.connector;
      instance.fetcher = http.fetcher;
    });
    expect(
      await ws.run("monitor.createTcp", {
        id: monitorId,
        name: "Database",
        host: "db.example.com",
        port: 5432,
        intervalSeconds: 60,
        timeoutSeconds: 5,
        regions: ["enam"],
      }),
    ).toMatchObject({ ok: true });
    await ws.withShard((_shard, instance) => instance.alarm());
    const rows = await runInDurableObject(enam, (instance: ProbeDO) => instance.rows());
    expect(rows.map((row) => JSON.parse(row.config))).toEqual([
      {
        kind: "tcp",
        id: monitorId,
        host: "db.example.com",
        port: 5432,
        intervalSeconds: 60,
        timeoutSeconds: 5,
      },
    ]);

    for (let run = 0; run < 3; run++) {
      const status = await ws.withShard((shard) => shard.store.get("monitors", monitorId)?.status);
      if (status === "down") break;
      await runProbe(enam);
    }
    await ws.withShard((shard) => {
      const monitor = shard.store.get("monitors", monitorId)!;
      expect(monitor).toMatchObject({ status: "down", alertId: expect.any(String) });
      expect(monitor.checks).toEqual([
        expect.objectContaining({ source: "enam", up: false, colo: "IAD", error: "network" }),
      ]);
      expect(shard.store.scan("incidents")).toEqual([
        expect.objectContaining({ title: "Database is down", declaredBy: "sys_monitors" }),
      ]);
    });
    // Only the trace went over HTTP; every check was a socket, and every socket was closed.
    expect(http.calls.every((call) => call.url.endsWith("/cdn-cgi/trace"))).toBe(true);
    expect(fake.closedCount()).toBe(fake.calls.length);

    refusing = false;
    for (let run = 0; run < 3; run++) {
      const status = await ws.withShard((shard) => shard.store.get("monitors", monitorId)?.status);
      if (status === "up") break;
      await runProbe(enam);
    }
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)).toMatchObject({ status: "up", alertId: null });
      expect(shard.store.scan("alerts")).toEqual([expect.objectContaining({ status: "resolved" })]);
    });
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

  test("taking the account back never pages the owner for a monitor its route kept quiet", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    await ws.run("monitor.createHttp", {
      id: monitorId,
      name: "Planted",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 5,
      regions: ["weur"],
    });
    expect(
      await ws.run("alertRoute.create", {
        id: newId("rte", Date.now(), random),
        name: "Quiet monitors",
        match: { sourceIds: ["monitors"], severities: [], labels: [] },
        action: { kind: "suppress" },
      }),
    ).toMatchObject({ ok: true });
    const at = Date.now();
    const verdict = (up: boolean, when: number) => ({
      reportId: newId("rep", when, random),
      id: monitorId,
      at: when,
      up,
      latencyMs: 80,
      colo: "CDG",
      httpStatus: up ? 200 : 503,
      error: up ? null : "status",
    });
    expect(await ws.stub.report("weur", [verdict(true, at - 2)])).toEqual([true]);
    expect(await ws.stub.report("weur", [verdict(false, at - 1)])).toEqual([true]);
    expect(await ws.stub.signOutUser(ws.id, admin.id, { takeOver: true })).toMatchObject({
      ok: true,
      paused: ["Planted"],
      routes: 1,
    });
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)).toMatchObject({
        paused: true,
        incidentId: null,
      });
      expect(shard.store.scan("incidents")).toEqual([]);
    });
  });

  test("a down monitor a deleted suppress route kept quiet is paged by the shard alarm if routing it again failed", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    const routeId = newId("rte", Date.now(), random);
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
    expect(
      await ws.run("alertRoute.create", {
        id: routeId,
        name: "Quiet monitors",
        match: { sourceIds: ["monitors"], severities: [], labels: [] },
        action: { kind: "suppress" },
      }),
    ).toMatchObject({ ok: true });
    const verdict = (up: boolean, at: number) => ({
      reportId: newId("rep", at, random),
      id: monitorId,
      at,
      up,
      latencyMs: 80,
      colo: "CDG",
      httpStatus: up ? 200 : 503,
      error: up ? null : "status",
    });
    const at = Date.now();
    expect(await ws.stub.report("weur", [verdict(true, at - 2)])).toEqual([true]);
    expect(await ws.stub.report("weur", [verdict(false, at - 1)])).toEqual([true]);
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)).toMatchObject({
        status: "down",
        incidentId: null,
        alertRoute: { id: routeId, outcome: "suppressed" },
      });
      expect(shard.store.scan("incidents")).toEqual([]);
    });
    // Deleted outside a member's socket, so the shard never ran its reroute: as if that had failed.
    expect(await ws.run("alertRoute.delete", { id: routeId })).toMatchObject({ ok: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await ws.withShard((_shard, instance) => instance.alarm());
    } finally {
      error.mockRestore();
    }
    await ws.withShard((shard, _instance, sql) => {
      const monitor = shard.store.get("monitors", monitorId)!;
      expect(monitor).toMatchObject({ status: "down", incidentId: expect.any(String) });
      expect(shard.store.get("incidents", monitor.incidentId!)).toMatchObject({
        title: "Checkout is down",
        declaredBy: "sys_monitors",
      });
      // The events carry the actor of the mutation that routed it again (`alert.reroute`, the alerts').
      expect(outbox(sql).slice(-3)).toEqual([
        "alert.resolved by sys_alerts",
        "incident.declared by sys_alerts",
        "alert.fired by sys_alerts",
      ]);
    });
  });

  test("quiet monitor alerts are routed again in chunks, a run at a time, and a row that fails alone waits", async () => {
    const ws = await workspace();
    const at = Date.now();
    const ids = Array.from({ length: 7 }, () => newId("mon", at, random));
    for (const [index, id] of ids.entries()) {
      await ws.run("monitor.createHttp", {
        id,
        name: `Checkout ${index + 1}`,
        url: "https://example.com/health",
        method: "GET",
        expectedStatus: null,
        keyword: null,
        intervalSeconds: 60,
        timeoutSeconds: 5,
        regions: ["weur"],
      });
    }
    const routeId = newId("rte", at, random);
    await ws.run("alertRoute.create", {
      id: routeId,
      name: "Quiet monitors",
      match: { sourceIds: ["monitors"], severities: [], labels: [] },
      action: { kind: "suppress" },
    });
    const verdict = (id: string, up: boolean, when: number) => ({
      reportId: newId("rep", when, random),
      id,
      at: when,
      up,
      latencyMs: 80,
      colo: "CDG",
      httpStatus: up ? 200 : 503,
      error: up ? null : "status",
    });
    const now = Date.now();
    expect(
      await ws.stub.report(
        "weur",
        ids.map((id) => verdict(id, true, now - 2)),
      ),
    ).toEqual(ids.map(() => true));
    expect(
      await ws.stub.report(
        "weur",
        ids.map((id) => verdict(id, false, now - 1)),
      ),
    ).toEqual(ids.map(() => true));
    // Deleted outside a member's socket: the shard has not routed them again yet.
    await ws.run("alertRoute.delete", { id: routeId });
    await ws.withShard((shard) => {
      const logs: string[] = [];
      const mutations: number[] = [];
      let bad: string | undefined;
      // One row whose `alert.reroute` is always refused: its chunk fails, so the chunk is run a row at a time.
      const flaky = {
        store: shard.store,
        mutate: (input: Parameters<Shard["mutate"]>[0]) => {
          const rows = (input.args as { rows: { rowId: string }[] }).rows;
          mutations.push(rows.length);
          if (rows.some((row) => row.rowId === bad)) {
            return {
              result: { ok: false, error: { code: "internal", message: "boom" } },
              changes: [],
            };
          }
          return shard.mutate(input);
        },
      } as unknown as Shard;
      const intake = new AlertIntake({
        shard: flaky,
        randomBytes: random,
        log: (message) => logs.push(message),
        committed: () => {},
        allow: async () => true,
      });
      const due = intake.rerouteDue();
      expect(due).toHaveLength(7);
      bad = due[0]!.row.id;
      const paged = () => ids.filter((id) => shard.store.get("monitors", id)?.incidentId).length;
      // At most 4 a run, 2 a chunk: the first chunk fails, then runs as two single rows.
      expect(intake.reroute(2, 4)).toBe(true);
      expect(mutations).toEqual([2, 1, 1, 2]);
      expect(paged()).toBe(3);
      expect(logs).toEqual(["routing a quiet alert again failed; tried again later"]);
      // The next run (the alarm's) takes the rest, and leaves the failed row alone for now.
      expect(intake.reroute(2, 4)).toBe(false);
      expect(paged()).toBe(6);
      expect(intake.rerouteDue()).toEqual([]);
      const later = Date.now();
      expect(intake.rerouteAt(later)).toBeGreaterThan(later);
      // Once its wait is over, it is tried again.
      expect(intake.rerouteDue(later + REROUTE_RETRY_MS).map((one) => one.row.id)).toEqual([bad]);
    });
  });

  test("a TCP monitor whose probes stop reporting turns unknown on the shard alarm too", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    await ws.run("monitor.createTcp", {
      id: monitorId,
      name: "Database",
      host: "db.example.com",
      port: 5432,
      intervalSeconds: 60,
      timeoutSeconds: 5,
      regions: ["weur"],
    });
    const at = Date.now();
    const up = {
      reportId: newId("rep", at, random),
      id: monitorId,
      at,
      up: true,
      latencyMs: 12,
      colo: "CDG",
      httpStatus: null,
      error: null,
    };
    expect(await ws.stub.report("weur", [up])).toEqual([true]);
    await ws.withShard((shard) => {
      const monitor = shard.store.get("monitors", monitorId)!;
      expect(monitor.status).toBe("up");
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
      expect(error).toHaveBeenCalledWith(expect.stringContaining("probe pushes failed"));
    } finally {
      error.mockRestore();
    }
  });

  test("a probe that never answers its push fails it in time, and the alarm goes on to the drain", async () => {
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
      await runInDurableObject(ws.stub, async (instance: WorkspaceDO) => {
        const monitoring = Reflect.get(instance, "monitoring") as object;
        const options = Reflect.get(monitoring, "options") as Record<string, unknown>;
        options.probes = { getByName: () => ({ configure: () => new Promise(() => {}) }) };
        let drained = false;
        const drain = Reflect.get(instance, "drainOutbox") as () => Promise<void>;
        Reflect.set(instance, "drainOutbox", () => {
          drained = true;
          return drain.call(instance);
        });
        const started = Date.now();
        await instance.alarm();
        expect(Date.now() - started).toBeLessThan(PROBE_PUSH_TIMEOUT_MS + 3000);
        expect(drained).toBe(true);
      });
      expect(error).toHaveBeenCalledWith(expect.stringContaining("probe push failed"));
    } finally {
      error.mockRestore();
    }
  }, 20_000);

  test("a probe connects to at most six targets at once, and closes every socket", async () => {
    const ws = await workspace();
    const stub = probe(ws.id, "apac");
    let open = 0;
    let most = 0;
    let closed = 0;
    // Each connection opens 20 ms later; the probe's pool (PARALLEL_CHECKS) bounds how many wait at once.
    const connector: Connector = () => {
      open++;
      most = Math.max(most, open);
      const opened = new Promise<SocketInfo>((resolve) => setTimeout(() => resolve({}), 20));
      return {
        opened,
        closed: opened.then(() => undefined),
        close: async () => {
          open--;
          closed++;
        },
      } as unknown as Socket;
    };
    const fake = fakeFetch("SIN", () => new Response("ok"));
    await runInDurableObject(stub, (instance: ProbeDO) => {
      instance.connector = connector;
      instance.fetcher = fake.fetcher;
    });
    const checks = Array.from({ length: 14 }, (_, port) => tcpConfig({ port: 2000 + port }));
    expect(await stub.configure(ws.id, "apac", checks)).toEqual({ ok: true });
    await runProbe(stub);
    expect(most).toBeLessThanOrEqual(6);
    expect(closed).toBe(14);
    const rows = await runInDurableObject(stub, (instance: ProbeDO) => instance.rows());
    expect(rows.every((row) => row.last_ok === 1)).toBe(true);
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
  test("the incident a missed beat opens is titled in the workspace's language (Q15)", async () => {
    const ws = await workspace("pt-BR");
    const monitorId = newId("mon", Date.now(), random);
    expect(
      await ws.run("monitor.createHeartbeat", {
        id: monitorId,
        name: "Backup noturno",
        intervalSeconds: 60,
        graceSeconds: 30,
        tokenHash: await sha256Hex(newHeartbeatSecret(random)),
      }),
    ).toMatchObject({ ok: true });
    // Never pinged, created 2 minutes ago: past the interval plus the grace.
    await ws.withShard((shard) => {
      const past = Date.now() - 120_000;
      shard.store.update("monitors", monitorId, { since: past, restartedAt: past });
      shard.store.update("heartbeats", monitorId, { lastPingAt: past });
    });
    await ws.withShard((_shard, instance) => instance.alarm());
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)?.status).toBe("down");
      expect(shard.store.scan("incidents")).toEqual([
        expect.objectContaining({ title: "Backup noturno está fora do ar" }),
      ]);
    });
  });

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

  test("a new URL: the old token is refused at once, the new one accepted, and neither leaves the shard", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    const old = newHeartbeatSecret(random);
    expect(
      await ws.run("monitor.createHeartbeat", {
        id: monitorId,
        name: "Nightly backup",
        intervalSeconds: 60,
        graceSeconds: 30,
        tokenHash: await sha256Hex(old),
      }),
    ).toMatchObject({ ok: true });
    const ping = (secret: string) =>
      exports.default.fetch(
        `http://localhost/heartbeat/${heartbeatToken(ws.id, monitorId, secret)}`,
        {
          method: "POST",
        },
      );
    expect((await ping(old)).status).toBe(202);

    const fresh = newHeartbeatSecret(random);
    const tokenHash = await sha256Hex(fresh);
    for (const role of ["responder", "viewer"] as const) {
      expect(
        await ws.run("monitor.rotateHeartbeat", { id: monitorId, tokenHash }, { ...admin, role }),
      ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    expect((await ping(fresh)).status).toBe(404);

    const { result, changes, outbox } = await ws.withShard((shard, _instance, sql) => {
      const before = Date.now();
      const done = shard.mutate({
        clientId: "test",
        mutationId: "rotate",
        actor: admin,
        name: "monitor.rotateHeartbeat",
        args: { id: monitorId, tokenHash },
        now: before,
      });
      const events = sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => row.event);
      return { ...done, outbox: events };
    });
    expect(result).toMatchObject({ ok: true });
    // What goes to sockets: the monitor row, never the server-only heartbeats table.
    expect(changes.map((change) => change.table)).toEqual(["monitors"]);
    expect(outbox.at(-1)).toContain("monitor.heartbeat_rotated");
    for (const text of [JSON.stringify(changes), ...outbox]) {
      expect(text).not.toContain(tokenHash);
      expect(text).not.toContain(fresh);
      expect(text).not.toContain(old);
    }

    expect((await ping(old)).status).toBe(404);
    // The old pinger's last beat is long past the interval and grace; the rotation gave a fresh window, so the
    // alarm reports no miss.
    await ws.withShard((shard) => {
      expect(shard.store.get("heartbeats", monitorId)?.lastPingAt).toBeNull();
    });
    await ws.withShard((_shard, instance) => instance.alarm());
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)).toMatchObject({
        status: "pending",
        checks: [],
      });
      expect(shard.store.get("heartbeats", monitorId)).toMatchObject({
        tokenHash,
        lastPingAt: null,
      });
    });
    expect((await ping(fresh)).status).toBe(202);
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)?.status).toBe("up");
    });
  });

  test("a rotated heartbeat whose new URL is never pinged still pages, and a firing one keeps its one alert", async () => {
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
    expect(
      (
        await exports.default.fetch(
          `http://localhost/heartbeat/${heartbeatToken(ws.id, monitorId, secret)}`,
          { method: "POST" },
        )
      ).status,
    ).toBe(202);
    const late = (60 + 30) * 1000;
    const clock = vi.spyOn(Date, "now");
    const start = Date.now();
    const rotate = (at: number) =>
      ws.withShard(async (shard) => {
        const { result } = shard.mutate({
          clientId: "test",
          mutationId: `rotate-${at}`,
          actor: admin,
          name: "monitor.rotateHeartbeat",
          args: { id: monitorId, tokenHash: await sha256Hex(newHeartbeatSecret(random)) },
          now: at,
        });
        expect(result).toMatchObject({ ok: true });
      });
    const alarmAt = async (at: number) => {
      clock.mockReturnValue(at);
      await ws.withShard((_shard, instance) => instance.alarm());
      return ws.withShard((shard, _instance, sql) => ({
        monitor: shard.store.get("monitors", monitorId)!,
        incidents: shard.store.scan("incidents"),
        fired: sql
          .exec<{ event: string }>("select event from outbox order by seq")
          .toArray()
          .filter((row) => row.event.includes('"alert.fired"')).length,
      }));
    };
    try {
      // Rotated 10 s after the last ping to the old URL, and nothing ever pings the new one.
      const rotated = start + 10_000;
      await rotate(rotated);
      // Past the old ping's deadline: the rotation's fresh window holds.
      expect((await alarmAt(start + late + 1)).monitor.status).toBe("pending");
      // Past the rotation's own deadline: the miss is reported and pages.
      const missed = await alarmAt(rotated + late + 1);
      expect(missed.monitor).toMatchObject({
        status: "down",
        alertId: expect.any(String),
        checks: [expect.objectContaining({ up: false, error: "missed" })],
      });
      expect(missed.fired).toBe(1);
      expect(missed.incidents).toEqual([
        expect.objectContaining({ id: missed.monitor.incidentId, status: "triage" }),
      ]);

      // Rotated again while down and paging: a miss after the new window keeps the same alert, no second one.
      const again = rotated + late + 60_000;
      await rotate(again);
      expect((await alarmAt(again + 1000)).monitor).toMatchObject({
        status: "pending",
        alertId: missed.monitor.alertId,
      });
      const still = await alarmAt(again + late + 1);
      expect(still.monitor).toMatchObject({
        status: "down",
        alertId: missed.monitor.alertId,
        incidentId: missed.monitor.incidentId,
      });
      expect(still.fired).toBe(1);
      expect(still.incidents).toEqual([
        expect.objectContaining({ id: missed.monitor.incidentId, status: "triage" }),
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  test("a D1 that never answers does not hold a ping: the lookup gives up and the shard decides", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    const secret = newHeartbeatSecret(random);
    await ws.run("monitor.createHeartbeat", {
      id: monitorId,
      name: "Nightly backup",
      intervalSeconds: 60,
      graceSeconds: 30,
      tokenHash: await sha256Hex(secret),
    });
    const hung = {
      prepare: () => ({ bind: () => ({ first: () => new Promise(() => {}) }) }),
    } as unknown as D1Database;
    const token = heartbeatToken(ws.id, monitorId, secret);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await receiveHeartbeat(
        new Request(`http://localhost/heartbeat/${token}`, { method: "POST" }),
        { ...env, DB: hung },
        token,
      );
      expect(response.status).toBe(202);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("workspace lookup failed"));
    } finally {
      errors.mockRestore();
    }
  }, 15_000);

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
