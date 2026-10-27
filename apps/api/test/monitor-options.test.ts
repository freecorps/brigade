// The per-monitor options of RFC 0007 on the probe's side, a paging path: request headers, status ranges and body
// patterns in the HTTP check, the config the shard pushes (unchanged for monitors that use none of them, so a deploy
// does not start every probe's streaks over), a monitor's own streak length and quorum opening its incident at its
// own severity, and the instance's monitor cap.
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import {
  MAX_MONITORS_PER_WORKSPACE,
  newId,
  type Actor,
  type MonitorRow,
  type ProbeRegion,
} from "@freecorps/brigade-schema";
import { httpCheck, MAX_BODY_BYTES, USER_AGENT, type HttpCheckConfig } from "../src/check.ts";
import { instanceMonitorCap, toConfig } from "../src/monitors.ts";
import { probeName, type ProbeDO } from "../src/probe.ts";
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

/** A fetcher that answers the trace with a colo and every check with `answer()`, recording each request. */
function fakeFetch(answer: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    if (url.endsWith("/cdn-cgi/trace")) return new Response("fl=1\ncolo=CDG\n");
    return answer();
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("httpCheck with the monitor's options", () => {
  test("sends its headers, and always Brigade's user agent", async () => {
    const { fetcher, calls } = fakeFetch(() => new Response("ok"));
    const headers = [
      { name: "Accept", value: "application/json" },
      { name: "X-Tenant", value: "acme" },
    ];
    expect(await httpCheck(fetcher, config({ headers }))).toMatchObject({ ok: true });
    const sent = new Headers(calls[0]!.init!.headers);
    expect(sent.get("accept")).toBe("application/json");
    expect(sent.get("x-tenant")).toBe("acme");
    expect(sent.get("user-agent")).toBe(USER_AGENT);
  });

  test("a header the rules refuse is never sent: the check is blocked without a request", async () => {
    const { fetcher, calls } = fakeFetch(() => new Response("ok"));
    for (const name of ["Authorization", "Host", "Cookie", "User-Agent"]) {
      expect(await httpCheck(fetcher, config({ headers: [{ name, value: "x" }] }))).toMatchObject({
        ok: false,
        error: "blocked",
      });
    }
    expect(calls).toEqual([]);
  });

  test("status ranges: any listed status or range is up", async () => {
    let status = 503;
    const { fetcher } = fakeFetch(() => new Response("x", { status }));
    const ranges = config({
      expectedStatuses: [
        { min: 200, max: 204 },
        { min: 500, max: 503 },
      ],
    });
    expect(await httpCheck(fetcher, ranges)).toMatchObject({ ok: true, httpStatus: 503 });
    status = 504;
    expect(await httpCheck(fetcher, ranges)).toMatchObject({ ok: false, error: "status" });
    status = 301;
    // Not listed, though a 3xx is up without a list.
    expect(await httpCheck(fetcher, ranges)).toMatchObject({ ok: false, error: "status" });
    expect(await httpCheck(fetcher, config())).toMatchObject({ ok: true });
  });

  test("a pattern in the body: matched by the linear engine, a refused one fails without a request", async () => {
    const { fetcher, calls } = fakeFetch(() => new Response('{"status": "OK", "db": "up"}'));
    const regex = (keyword: string) => config({ keyword, keywordMode: "regex" });
    expect(await httpCheck(fetcher, regex('"status":\\s*"(?:ok|OK)"'))).toMatchObject({ ok: true });
    expect(await httpCheck(fetcher, regex('(?i)"db": "UP"'))).toMatchObject({ ok: true });
    expect(await httpCheck(fetcher, regex('"status":\\s*"down"'))).toMatchObject({
      ok: false,
      error: "keyword",
    });
    // As plain text, the pattern's characters are literal.
    expect(await httpCheck(fetcher, config({ keyword: '"(?:ok|OK)"' }))).toMatchObject({
      ok: false,
      error: "keyword",
    });
    const before = calls.length;
    expect(await httpCheck(fetcher, regex("(a)\\1"))).toMatchObject({
      ok: false,
      error: "keyword",
    });
    expect(calls).toHaveLength(before);
  });

  test("a catastrophic pattern against a full body still answers at once", async () => {
    const body = `${"a".repeat(MAX_BODY_BYTES - 1)}!`;
    const { fetcher } = fakeFetch(() => new Response(`${body}${"a".repeat(1024)}`));
    const started = Date.now();
    // What was read ends in `!`: the classic exponential case for a backtracking engine, here a quick "no".
    expect(
      await httpCheck(fetcher, config({ keyword: "(a+)+$", keywordMode: "regex" })),
    ).toMatchObject({ ok: false, error: "keyword" });
    // The read stops at MAX_BODY_BYTES, so `$` is the end of what was read.
    expect(
      await httpCheck(fetcher, config({ keyword: "(a+)+!$", keywordMode: "regex" })),
    ).toMatchObject({ ok: true });
    expect(
      await httpCheck(fetcher, config({ keyword: "(a|aa)*b", keywordMode: "regex" })),
    ).toMatchObject({ ok: false, error: "keyword" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

const row = (overrides: Partial<MonitorRow>): MonitorRow => ({
  id: "mon_01M5YG9PE0RWW3X24S7GFY6HTB",
  name: "Checkout",
  kind: "http",
  url: "https://example.com/health",
  method: "GET",
  expectedStatus: null,
  keyword: null,
  host: null,
  port: null,
  timeoutSeconds: 10,
  regions: ["weur"],
  intervalSeconds: 60,
  graceSeconds: null,
  paused: false,
  pausedBy: null,
  pausedAt: null,
  status: "up",
  since: 0,
  restartedAt: 0,
  checks: [],
  alertId: null,
  incidentId: null,
  createdAt: 0,
  createdBy: "usr_ana",
  updatedAt: 0,
  ...overrides,
});

describe("the config the shard pushes", () => {
  test("a monitor that uses none of the options pushes what it pushed before them", () => {
    // Rows from before, and rows saved since with every default spelled out, alike.
    for (const monitor of [
      row({ expectedStatus: 204 }),
      row({
        expectedStatus: null,
        expectedStatuses: [{ min: 204, max: 204 }],
        keywordMode: "text",
        headers: [],
        quorum: 2,
        consecutiveChecks: 2,
        severity: "sev1",
      }),
    ]) {
      expect(JSON.stringify(toConfig(monitor))).toBe(
        JSON.stringify({
          id: monitor.id,
          url: "https://example.com/health",
          method: "GET",
          expectedStatus: 204,
          keyword: null,
          intervalSeconds: 60,
          timeoutSeconds: 10,
        }),
      );
    }
    expect(
      JSON.stringify(
        toConfig(row({ kind: "tcp", host: "db.example.com", port: 5432, url: null, method: null })),
      ),
    ).toBe(
      JSON.stringify({
        kind: "tcp",
        id: "mon_01M5YG9PE0RWW3X24S7GFY6HTB",
        host: "db.example.com",
        port: 5432,
        intervalSeconds: 60,
        timeoutSeconds: 10,
      }),
    );
  });

  test("what a probe needs is pushed once it is set; quorum and severity stay on the shard", () => {
    expect(
      toConfig(
        row({
          expectedStatuses: [{ min: 200, max: 299 }],
          keyword: "ok",
          keywordMode: "regex",
          headers: [{ name: "Accept", value: "text/html" }],
          consecutiveChecks: 3,
          quorum: 1,
          severity: "sev1",
        }),
      ),
    ).toEqual({
      id: "mon_01M5YG9PE0RWW3X24S7GFY6HTB",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: null,
      expectedStatuses: [{ min: 200, max: 299 }],
      keyword: "ok",
      keywordMode: "regex",
      headers: [{ name: "Accept", value: "text/html" }],
      intervalSeconds: 60,
      timeoutSeconds: 10,
      consecutiveChecks: 3,
    });
    // A pattern mode without a keyword has nothing to match.
    expect(toConfig(row({ keywordMode: "regex" }))).not.toHaveProperty("keywordMode");
  });
});

describe("the instance's monitor cap", () => {
  test("MAX_MONITORS when it is a whole number in range, else the default", () => {
    expect(instanceMonitorCap({})).toBe(MAX_MONITORS_PER_WORKSPACE);
    expect(instanceMonitorCap({ MAX_MONITORS: "" })).toBe(MAX_MONITORS_PER_WORKSPACE);
    expect(instanceMonitorCap({ MAX_MONITORS: " 500 " })).toBe(500);
    expect(instanceMonitorCap({ MAX_MONITORS: "10000" })).toBe(10_000);
    for (const bad of ["0", "-5", "1.5", "lots", "10001", "1e3"]) {
      expect(instanceMonitorCap({ MAX_MONITORS: bad }), bad).toBe(MAX_MONITORS_PER_WORKSPACE);
    }
  });
});

let names = 0;

async function workspace() {
  const id = newId("ws", Date.now() + ++names, random);
  await env.DB.prepare(
    'insert into "organization" ("id", "name", "slug", "createdAt") values (?, ?, ?, ?)',
  )
    .bind(id, "Acme", `ws-${id}`, new Date().toISOString())
    .run();
  const stub = env.WORKSPACE.getByName(id);
  expect(await stub.provision({ id, name: "Acme" }, { ...admin, role: "owner" })).toEqual({
    ok: true,
  });
  const withShard = <R>(fn: (shard: Shard, instance: WorkspaceDO) => R | Promise<R>) =>
    runInDurableObject(stub, (instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        instance,
      ),
    );
  let mutation = 0;
  const run = (name: string, args: object) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: `m${++mutation}`,
        actor: admin,
        name,
        args,
        now: Date.now(),
      });
      return result;
    });
  return { id, withShard, run };
}

function probe(workspaceId: string, region: ProbeRegion) {
  return env.PROBE.getByName(probeName(workspaceId, region), { locationHint: region });
}

async function runProbe(stub: DurableObjectStub<ProbeDO>) {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("update probe_checks set next_at = 0");
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
}

describe("a monitor's own quorum, streak and severity, end to end", () => {
  test("one failed check in one of two regions opens its incident at its severity; it recovers on both", async () => {
    const ws = await workspace();
    const monitorId = newId("mon", Date.now(), random);
    const enam = probe(ws.id, "enam");
    const weur = probe(ws.id, "weur");
    let weurStatus = 200;
    await runInDurableObject(enam, (instance: ProbeDO) => {
      instance.fetcher = fakeFetch(() => new Response("ok")).fetcher;
    });
    await runInDurableObject(weur, (instance: ProbeDO) => {
      instance.fetcher = fakeFetch(() => new Response("x", { status: weurStatus })).fetcher;
    });
    expect(
      await ws.run("monitor.createHttp", {
        id: monitorId,
        name: "Checkout",
        url: "https://example.com/health",
        method: "GET",
        keyword: null,
        intervalSeconds: 60,
        timeoutSeconds: 5,
        regions: ["enam", "weur"],
        quorum: 1,
        consecutiveChecks: 1,
        severity: "sev1",
      }),
    ).toMatchObject({ ok: true });
    await ws.withShard((_shard, instance) => instance.alarm());
    // The streak length reached the probe with the config.
    const [pushed] = await runInDurableObject(weur, (instance: ProbeDO) => instance.rows());
    expect(JSON.parse(pushed!.config)).toMatchObject({ consecutiveChecks: 1 });
    await runProbe(enam);
    await runProbe(weur);
    expect(await ws.withShard((shard) => shard.store.get("monitors", monitorId)?.status)).toBe(
      "up",
    );

    // One failure in one region: with a streak of one and a quorum of one, that is down at once.
    weurStatus = 503;
    await runProbe(weur);
    await ws.withShard((shard) => {
      const monitor = shard.store.get("monitors", monitorId)!;
      expect(monitor).toMatchObject({ status: "down", alertId: expect.any(String) });
      expect(shard.store.scan("incidents")).toEqual([
        expect.objectContaining({ id: monitor.incidentId, severity: "sev1" }),
      ]);
    });
    // The other region still up changes nothing: down holds while any region is down.
    await runProbe(enam);
    expect(await ws.withShard((shard) => shard.store.get("monitors", monitorId)?.status)).toBe(
      "down",
    );

    weurStatus = 200;
    await runProbe(weur);
    await ws.withShard((shard) => {
      expect(shard.store.get("monitors", monitorId)).toMatchObject({ status: "up", alertId: null });
      expect(shard.store.scan("alerts")).toEqual([expect.objectContaining({ status: "resolved" })]);
      expect(shard.store.scan("incidents")).toHaveLength(1);
    });
  });
});
