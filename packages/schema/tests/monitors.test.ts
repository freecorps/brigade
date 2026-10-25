import { describe, expect, test, vi } from "vite-plus/test";
import {
  activeIncidents,
  createMemoryStore,
  defineMutation,
  defineRegistry,
  evaluateQuery,
  freshFloor,
  MONITOR_ACTOR,
  monitorSources,
  monitorStatus,
  mutations,
  newId,
  ok,
  queries,
  quorum,
  REPORT_EVERY_MS,
  runMutation,
  serverMutations,
  staleAfterMs,
  targetProblem,
  v,
  type BrigadeTables,
  type MemoryStore,
  type MonitorCheck,
  type MonitorRow,
  type MutationContext,
  type MutationResult,
  type ProbeRegion,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 24, 12, 0, 0);
let seed = 0;
const random = (n: number) => new Uint8Array(n).fill(++seed % 256);
const HASH = "a".repeat(64);

const as = (role: Role, now = T): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now,
  server: true,
});
const system = (now = T): MutationContext => ({ actor: MONITOR_ACTOR, now, server: true });

const httpArgs = (regions: ProbeRegion[] = ["weur"], overrides: object = {}) => ({
  id: newId("mon", T, random),
  name: "Checkout",
  url: "https://example.com/health",
  method: "GET",
  expectedStatus: null,
  keyword: null,
  intervalSeconds: 60,
  timeoutSeconds: 10,
  regions,
  ...overrides,
});

const store = () => createMemoryStore<BrigadeTables>();

function createHttp(db: MemoryStore<BrigadeTables>, regions: ProbeRegion[], name = "Checkout") {
  const args = httpArgs(regions, { name });
  const result = runMutation(mutations, "monitor.createHttp", args, db, as("admin"));
  expect(result.ok).toBe(true);
  return args.id;
}

const open = () => ({
  alertId: newId("alt", T, random),
  incidentId: newId("inc", T, random),
  title: "Checkout is down",
});

/** One source's verdict, computed at `at` and delivered at `deliveredAt` (by default at once). */
function report(
  db: MemoryStore<BrigadeTables>,
  id: string,
  source: string,
  up: boolean,
  at = T + 1000,
  deliveredAt = at,
) {
  return runMutation(
    serverMutations,
    "monitor.report",
    {
      id,
      source,
      at,
      up,
      latencyMs: 42,
      colo: "CDG",
      httpStatus: up ? 200 : 503,
      error: up ? null : "status",
      open: open(),
    },
    db,
    system(deliveredAt),
  );
}

const evaluate = (db: MemoryStore<BrigadeTables>, id: string, now: number) =>
  runMutation(serverMutations, "monitor.evaluate", { id, open: open() }, db, system(now));

const types = (result: MutationResult) =>
  result.ok ? result.events.map((event) => event.type) : result.error.code;

describe("validators", () => {
  test("integer, boolean, nullable and array", () => {
    const int = v.integer({ min: 1, max: 3 });
    expect(int(2)).toEqual({ ok: true, value: 2 });
    for (const bad of [0, 4, 1.5, "2", Number.NaN, null]) expect(int(bad).ok).toBe(false);
    expect(v.boolean()(false)).toEqual({ ok: true, value: false });
    expect(v.boolean()(0).ok).toBe(false);
    expect(v.nullable(int)(null)).toEqual({ ok: true, value: null });
    const list = v.array(v.picklist(["a", "b"] as const), { min: 1, max: 2, unique: true });
    expect(list(["b", "a"])).toEqual({ ok: true, value: ["b", "a"] });
    expect(list([]).ok).toBe(false);
    expect(list(["a", "a"])).toMatchObject({ ok: false, issues: [{ path: "[1]" }] });
    expect(list(["a", "b", "a"]).ok).toBe(false);
    expect(list("a").ok).toBe(false);
  });
});

describe("targets (SSRF)", () => {
  test("accepts public http and https URLs", () => {
    for (const url of [
      "https://example.com/health",
      "https://1.1.1.1/",
      "https://example.com:8443/health",
      "http://example.com:8080/",
      "https://[2606:4700::1111]/",
      "http://172.32.0.1/",
    ]) {
      expect(targetProblem(url), url).toBeNull();
    }
  });

  test("refuses other schemes, credentials, and private, loopback or link-local hosts", () => {
    for (const url of [
      "ftp://example.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@example.com/",
      "not a url",
      "http://localhost:8787/",
      "http://LOCALHOST./",
      "http://api.localhost/",
      "http://printer.local/",
      "http://metadata.google.internal/",
      "http://intranet/",
      "http://127.0.0.1/",
      "http://127.1/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://0.0.0.0/",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://224.0.0.1/",
      "http://[::1]/",
      "http://[::]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[2001:db8::1]/",
      "http://[2002:a00:1::]/",
      "http://192.88.99.1/",
      "http://[2001:2::1]/",
      "http://[2001:10::1]/",
      "http://[2001:1f:ffff::1]/",
      // Ports other than MONITOR_PORTS: a monitor is no port scanner.
      "http://example.com:22/",
      "http://example.com:25/",
      "http://example.com:6379/",
      "https://example.com:3000/",
    ]) {
      expect(targetProblem(url), url).not.toBeNull();
    }
  });

  test("monitor.createHttp refuses a private target and stores the normalised URL", () => {
    const db = store();
    const refused = runMutation(
      mutations,
      "monitor.createHttp",
      httpArgs(["weur"], { url: "http://169.254.169.254/" }),
      db,
      as("admin"),
    );
    expect(refused).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    const args = httpArgs(["weur"], { url: "HTTPS://Example.COM" });
    expect(runMutation(mutations, "monitor.createHttp", args, db, as("admin")).ok).toBe(true);
    expect(db.get("monitors", args.id)?.url).toBe("https://example.com/");
  });
});

describe("quorum and freshness", () => {
  const check = (source: ProbeRegion, up: boolean, at = T): MonitorCheck => ({
    source,
    at,
    up,
    latencyMs: null,
    colo: null,
    httpStatus: null,
    error: null,
  });
  const monitor = (
    regions: ProbeRegion[],
    status: MonitorRow["status"] = "up",
  ): Pick<MonitorRow, "kind" | "regions" | "intervalSeconds" | "status" | "restartedAt"> => ({
    kind: "http",
    regions,
    intervalSeconds: 60,
    status,
    restartedAt: T - 60 * 60_000,
  });

  test("one region is its own quorum; N regions need a majority, and half of them fresh", () => {
    expect([1, 2, 3, 4, 5, 6].map(quorum)).toEqual([1, 2, 2, 3, 3, 4]);
    expect([1, 2, 3, 4, 5, 6].map(freshFloor)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  test("down or up takes a majority of the fresh results; otherwise the status holds", () => {
    const three = monitor(["wnam", "weur", "apac"]);
    const status = (checks: MonitorCheck[], current = three) => monitorStatus(current, checks, T);
    expect(status([check("wnam", false), check("weur", true)])).toBe("up");
    expect(status([check("wnam", false), check("weur", false)])).toBe("down");
    expect(status([check("wnam", true), check("weur", false)], { ...three, status: "down" })).toBe(
      "down",
    );
    expect(status([check("wnam", true), check("weur", true)], { ...three, status: "down" })).toBe(
      "up",
    );
    // A result from a region the monitor no longer uses does not count.
    expect(monitorStatus(monitor(["wnam"]), [check("weur", false), check("wnam", true)], T)).toBe(
      "up",
    );
  });

  test("results older than the stale window stop voting; too few fresh ones is no data", () => {
    const three = monitor(["wnam", "weur", "apac"]);
    const window = staleAfterMs(three);
    // Two refresh periods at least, since an unchanged verdict is only re-sent that often.
    expect(window).toBe(2 * REPORT_EVERY_MS);
    expect(staleAfterMs({ kind: "http", intervalSeconds: 3600 })).toBe(3 * 3600_000);
    expect(staleAfterMs({ kind: "heartbeat", intervalSeconds: 60 })).toBe(Infinity);
    const old = T - window - 1;
    // Two fresh downs and a stale up: down.
    expect(
      monitorStatus(three, [check("wnam", false), check("weur", false), check("apac", true, old)], T),
    ).toBe("down");
    // One fresh up and two stale downs: one region cannot speak for three.
    expect(
      monitorStatus(
        { ...three, status: "down" },
        [check("wnam", true), check("weur", false, old), check("apac", false, old)],
        T,
      ),
    ).toBe("unknown");
    // Every probe silent: never "up".
    expect(
      monitorStatus(three, [check("wnam", true, old), check("weur", true, old)], T),
    ).toBe("unknown");
    // Just created and nothing reported yet: still pending, until the window passes.
    const created = { ...three, status: "pending" as const, restartedAt: T };
    expect(monitorStatus(created, [], T + window)).toBe("pending");
    expect(monitorStatus(created, [], T + window + 1)).toBe("unknown");
  });

  test("a heartbeat monitor has one source, which never goes stale", () => {
    expect(monitorSources({ kind: "heartbeat", regions: [] })).toEqual(["heartbeat"]);
    expect(monitorSources({ kind: "http", regions: ["enam", "oc"] })).toEqual(["enam", "oc"]);
    const beat: MonitorCheck = { ...check("wnam", true, 0), source: "heartbeat" };
    expect(
      monitorStatus(
        { kind: "heartbeat", regions: [], intervalSeconds: 60, status: "up", restartedAt: 0 },
        [beat],
        T,
      ),
    ).toBe("up");
  });
});

describe("managing monitors", () => {
  test("owners and admins manage monitors; responders and viewers only read them", () => {
    for (const role of ["responder", "viewer"] as const) {
      const result = runMutation(mutations, "monitor.createHttp", httpArgs(), store(), as(role));
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    for (const role of ["owner", "admin"] as const) {
      const result = runMutation(mutations, "monitor.createHttp", httpArgs(), store(), as(role));
      expect(result.ok).toBe(true);
    }
  });

  test("create, update, pause, resume and delete each emit their event", () => {
    const db = store();
    const args = httpArgs(["weur", "wnam"]);
    const created = runMutation(mutations, "monitor.createHttp", args, db, as("admin"));
    expect(created).toEqual({
      ok: true,
      events: [
        {
          type: "monitor.created",
          subject: args.id,
          data: { id: args.id, name: "Checkout", kind: "http" },
        },
      ],
    });
    // Regions come back in PROBE_REGIONS order.
    expect(db.get("monitors", args.id)).toMatchObject({
      regions: ["wnam", "weur"],
      status: "pending",
      paused: false,
      pausedBy: null,
      pausedAt: null,
      restartedAt: T,
      createdBy: "usr_ana",
    });

    const same = runMutation(mutations, "monitor.updateHttp", args, db, as("admin"));
    expect(same).toMatchObject({ ok: false, error: { code: "conflict" } });
    const renamed = { ...args, name: "Checkout API" };
    expect(types(runMutation(mutations, "monitor.updateHttp", renamed, db, as("admin")))).toEqual([
      "monitor.updated",
    ]);

    const pause = { id: args.id, paused: true };
    expect(
      types(runMutation(mutations, "monitor.setPaused", pause, db, as("admin", T + 500))),
    ).toEqual(["monitor.paused"]);
    expect(db.get("monitors", args.id)).toMatchObject({ pausedBy: "usr_ana", pausedAt: T + 500 });
    expect(runMutation(mutations, "monitor.setPaused", pause, db, as("admin")).ok).toBe(false);
    const resume = { id: args.id, paused: false };
    expect(
      types(runMutation(mutations, "monitor.setPaused", resume, db, as("admin", T + 900))),
    ).toEqual(["monitor.resumed"]);
    expect(db.get("monitors", args.id)).toMatchObject({
      pausedBy: null,
      pausedAt: null,
      restartedAt: T + 900,
    });
    const remove = { id: args.id };
    expect(types(runMutation(mutations, "monitor.delete", remove, db, as("admin")))).toEqual([
      "monitor.deleted",
    ]);
    expect(db.get("monitors", args.id)).toBeUndefined();
  });

  test("HTTP rules: interval of at least 30 s, a timeout within it, no keyword for HEAD", () => {
    const run = (overrides: object) =>
      runMutation(
        mutations,
        "monitor.createHttp",
        httpArgs(["weur"], overrides),
        store(),
        as("admin"),
      );
    expect(run({ intervalSeconds: 29 })).toMatchObject({ error: { code: "invalid_args" } });
    expect(run({ timeoutSeconds: 31 })).toMatchObject({ error: { code: "invalid_args" } });
    expect(run({ method: "HEAD", keyword: "ok" })).toMatchObject({
      error: { issues: [{ path: "keyword" }] },
    });
    expect(run({ regions: [] })).toMatchObject({ error: { code: "invalid_args" } });
    // Regions where Durable Objects do not spawn are not offered (spike S2).
    expect(run({ regions: ["sam"] })).toMatchObject({ error: { code: "invalid_args" } });
    expect(run({ expectedStatus: 204, keyword: "ok" }).ok).toBe(true);
  });

  test("a heartbeat keeps its token hash server-side only", () => {
    const id = newId("mon", T, random);
    const args = {
      id,
      name: "Nightly backup",
      intervalSeconds: 3600,
      graceSeconds: 300,
      tokenHash: HASH,
    };
    const client = store();
    runMutation(mutations, "monitor.createHeartbeat", args, client, {
      ...as("admin"),
      server: false,
    });
    expect(client.get("monitors", id)).toBeDefined();
    expect(client.get("heartbeats", id)).toBeUndefined();

    const db = store();
    expect(runMutation(mutations, "monitor.createHeartbeat", args, db, as("admin")).ok).toBe(true);
    expect(db.get("heartbeats", id)).toEqual({ id, tokenHash: HASH, lastPingAt: null });
    expect(JSON.stringify(db.get("monitors", id))).not.toContain(HASH);
    const bad = { ...args, id: newId("mon", T, random), tokenHash: "not-a-hash" };
    expect(runMutation(mutations, "monitor.createHeartbeat", bad, db, as("admin")).ok).toBe(false);
  });
});

describe("monitor.report: quorum → alert → incident", () => {
  test("is server only", () => {
    const db = store();
    const id = createHttp(db, ["weur"]);
    for (const name of ["monitor.report", "monitor.evaluate"]) {
      const result = runMutation(mutations, name as never, { id }, db, as("owner"));
      expect(result).toMatchObject({ ok: false, error: { code: "unknown_mutation" } });
    }
  });

  test("one region: down fires one alert and declares one incident as the system actor", () => {
    const db = store();
    const id = createHttp(db, ["weur"]);
    expect(types(report(db, id, "weur", true, T + 1000))).toEqual([
      "monitor.checked",
      "monitor.status_changed",
    ]);
    expect(db.get("monitors", id)?.status).toBe("up");

    const down = report(db, id, "weur", false, T + 2000);
    // The incident's event before the alert's, so a consumer of alert.fired can find its incident.
    expect(types(down)).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "incident.declared",
      "alert.fired",
    ]);
    const monitor = db.get("monitors", id)!;
    expect(monitor).toMatchObject({ status: "down", alertId: expect.any(String) });
    expect(monitor.checks).toEqual([
      {
        source: "weur",
        at: T + 2000,
        up: false,
        latencyMs: 42,
        colo: "CDG",
        httpStatus: 503,
        error: "status",
      },
    ]);
    const [incident] = evaluateQuery(activeIncidents, {}, db);
    expect(incident).toMatchObject({
      id: monitor.incidentId,
      title: "Checkout is down",
      severity: "sev2",
      status: "triage",
      declaredBy: "sys_monitors",
      number: 1,
    });
    expect(db.get("alerts", monitor.alertId!)).toMatchObject({
      status: "firing",
      fingerprint: `monitor:${id}`,
      incidentId: incident.id,
    });

    // Still down: deduplicated, no second alert or incident. The unchanged verdict refreshes the row only, with
    // no event for the outbox.
    expect(types(report(db, id, "weur", false, T + 3000))).toEqual([]);
    expect(db.get("monitors", id)?.checks[0]?.at).toBe(T + 3000);
    expect(db.scan("alerts")).toHaveLength(1);
    expect(db.scan("incidents")).toHaveLength(1);

    // Recovery resolves the alert; the incident stays for people.
    expect(types(report(db, id, "weur", true, T + 4000))).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "alert.resolved",
    ]);
    expect(db.get("alerts", monitor.alertId!)).toMatchObject({
      status: "resolved",
      resolvedAt: T + 4000,
    });
    expect(db.get("monitors", id)).toMatchObject({ status: "up", alertId: null });
    expect(evaluateQuery(activeIncidents, {}, db)).toHaveLength(1);

    // Down again: a new alert and a new incident.
    expect(types(report(db, id, "weur", false, T + 5000))).toContain("incident.declared");
    expect(db.scan("incidents")).toHaveLength(2);
  });

  test("three regions: one failing region is not down; two are", () => {
    const db = store();
    const id = createHttp(db, ["wnam", "weur", "apac"]);
    report(db, id, "wnam", false);
    expect(db.get("monitors", id)?.status).toBe("pending");
    expect(db.scan("alerts")).toEqual([]);
    expect(types(report(db, id, "apac", false))).toContain("alert.fired");
    expect(db.get("monitors", id)?.status).toBe("down");
  });

  test("runs with RBAC: an actor whose role cannot manage monitors changes nothing", () => {
    const db = store();
    const id = createHttp(db, ["weur"]);
    const viewer = { ...MONITOR_ACTOR, role: "viewer" as const };
    const result = runMutation(
      serverMutations,
      "monitor.report",
      {
        id,
        source: "weur",
        at: T + 1000,
        up: false,
        latencyMs: null,
        colo: null,
        httpStatus: null,
        error: "timeout",
        open: {
          alertId: newId("alt", T, random),
          incidentId: newId("inc", T, random),
          title: "Checkout is down",
        },
      },
      db,
      { actor: viewer, now: T + 1000, server: true },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(db.scan("alerts")).toEqual([]);
  });

  test("refuses late, paused, unknown-source and missing-monitor reports", () => {
    const db = store();
    const id = createHttp(db, ["weur"]);
    report(db, id, "weur", true, T + 5000);
    expect(report(db, id, "weur", false, T + 4000)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(report(db, id, "apac", false, T + 6000)).toMatchObject({
      error: { code: "conflict" },
    });
    expect(report(db, newId("mon", T, random), "weur", false)).toMatchObject({
      error: { code: "not_found" },
    });
    runMutation(mutations, "monitor.setPaused", { id, paused: true }, db, as("admin", T + 6000));
    expect(report(db, id, "weur", false, T + 7000)).toMatchObject({ error: { code: "conflict" } });
    expect(db.scan("incidents")).toEqual([]);
  });

  test("pausing or deleting a down monitor resolves its alert, not the incident", () => {
    const db = store();
    const id = createHttp(db, ["weur"]);
    report(db, id, "weur", false);
    const pause = runMutation(
      mutations,
      "monitor.setPaused",
      { id, paused: true },
      db,
      as("admin", T + 2000),
    );
    expect(types(pause)).toEqual(["monitor.paused", "alert.resolved"]);
    expect(db.get("monitors", id)).toMatchObject({ status: "pending", alertId: null, checks: [] });

    runMutation(mutations, "monitor.setPaused", { id, paused: false }, db, as("admin", T + 3000));
    report(db, id, "weur", false, T + 4000);
    const remove = runMutation(mutations, "monitor.delete", { id }, db, as("admin", T + 5000));
    expect(types(remove)).toEqual(["monitor.deleted", "alert.resolved"]);
    expect(db.scan("alerts").every((alert) => alert.status === "resolved")).toBe(true);
    expect(evaluateQuery(activeIncidents, {}, db)).toHaveLength(2);
  });

  test("changing the target starts over; renaming keeps the results", () => {
    const db = store();
    const args = httpArgs(["weur"]);
    runMutation(mutations, "monitor.createHttp", args, db, as("admin"));
    report(db, args.id, "weur", true, T + 1000);
    runMutation(mutations, "monitor.updateHttp", { ...args, name: "Shop" }, db, as("admin"));
    expect(db.get("monitors", args.id)?.status).toBe("up");
    const moved = { ...args, name: "Shop", url: "https://example.com/other" };
    runMutation(mutations, "monitor.updateHttp", moved, db, as("admin", T + 2000));
    expect(db.get("monitors", args.id)).toMatchObject({ status: "pending", checks: [] });
  });

  test("down monitors sort first, then by name", () => {
    const db = store();
    const a = createHttp(db, ["weur"], "A");
    const b = createHttp(db, ["weur"], "B");
    const c = createHttp(db, ["weur"], "C");
    report(db, c, "weur", false);
    expect(evaluateQuery(queries["monitors.all"], {}, db).map((row) => row.id)).toEqual([c, a, b]);
  });
});

describe("monitor.report: restarts, refreshes and stale probes", () => {
  test("a report computed before another region flipped the status still counts", () => {
    // The reviewer's case: wnam and enam down → down; weur's down, computed before the flip, arrives after it;
    // wnam recovers. Two of three regions are still down: no recovery and no second incident.
    const db = store();
    const id = createHttp(db, ["wnam", "enam", "weur"]);
    report(db, id, "wnam", false, T + 1000);
    expect(types(report(db, id, "enam", false, T + 2000))).toContain("incident.declared");
    expect(db.get("monitors", id)).toMatchObject({ status: "down", since: T + 2000 });

    const late = report(db, id, "weur", false, T + 1500, T + 2500);
    expect(types(late)).toEqual(["monitor.checked"]);
    expect(types(report(db, id, "wnam", true, T + 3000))).toEqual(["monitor.checked"]);
    expect(db.get("monitors", id)?.status).toBe("down");

    // Five minutes on: the probes re-send their unchanged verdicts, still down, still one incident.
    const later = T + 3000 + REPORT_EVERY_MS;
    for (const [region, up] of [
      ["wnam", true],
      ["enam", false],
      ["weur", false],
    ] as const) {
      expect(types(report(db, id, region, up, later))).toEqual([]);
    }
    expect(db.get("monitors", id)?.status).toBe("down");
    expect(db.scan("incidents")).toHaveLength(1);
    expect(db.scan("alerts")).toEqual([expect.objectContaining({ status: "firing" })]);
  });

  test("only a restart cuts results off", () => {
    const db = store();
    const args = httpArgs(["weur"]);
    runMutation(mutations, "monitor.createHttp", args, db, as("admin"));
    expect(report(db, args.id, "weur", true, T - 1)).toMatchObject({
      error: { code: "conflict" },
    });
    report(db, args.id, "weur", true, T + 1000);
    const moved = { ...args, url: "https://example.com/other" };
    runMutation(mutations, "monitor.updateHttp", moved, db, as("admin", T + 2000));
    expect(db.get("monitors", args.id)).toMatchObject({ restartedAt: T + 2000, status: "pending" });
    // Checked the old URL before the change: refused.
    expect(report(db, args.id, "weur", false, T + 1999, T + 2100)).toMatchObject({
      error: { code: "conflict" },
    });
    expect(report(db, args.id, "weur", true, T + 2001).ok).toBe(true);
  });

  test("a monitor whose probes stop reporting turns unknown, never up, and keeps its alert", () => {
    const db = store();
    const id = createHttp(db, ["wnam", "enam", "weur"]);
    for (const region of ["wnam", "enam", "weur"] as const) report(db, id, region, false, T + 1000);
    const monitor = db.get("monitors", id)!;
    expect(monitor.status).toBe("down");
    const window = staleAfterMs(monitor);

    // Within the window nothing changes.
    expect(evaluate(db, id, T + 1000 + window)).toMatchObject({ error: { code: "conflict" } });
    // Then the probes have been silent too long: no data, the alert stays firing, nothing resolves.
    expect(types(evaluate(db, id, T + 1001 + window))).toEqual(["monitor.status_changed"]);
    expect(db.get("monitors", id)).toMatchObject({
      status: "unknown",
      alertId: monitor.alertId,
      incidentId: monitor.incidentId,
    });
    expect(db.get("alerts", monitor.alertId!)?.status).toBe("firing");

    // Fresh results come back up: that is the recovery, and it resolves the alert.
    const back = T + 2 * window;
    report(db, id, "wnam", true, back);
    expect(types(report(db, id, "enam", true, back))).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "alert.resolved",
    ]);
    expect(db.scan("incidents")).toHaveLength(1);
  });

  test("a monitor whose probes never report leaves pending for unknown", () => {
    const db = store();
    const id = createHttp(db, ["weur", "wnam"]);
    const window = staleAfterMs(db.get("monitors", id)!);
    expect(evaluate(db, id, T + window)).toMatchObject({ error: { code: "conflict" } });
    expect(types(evaluate(db, id, T + window + 1))).toEqual(["monitor.status_changed"]);
    expect(db.get("monitors", id)?.status).toBe("unknown");
    expect(db.scan("alerts")).toEqual([]);
  });

  test("a storage failure while declaring the incident is thrown, not stored as the report's answer", () => {
    const db = store();
    const id = createHttp(db, ["weur"]);
    const failure = new Error("storage is down");
    const insert = db.insert.bind(db);
    const broken = Object.assign(Object.create(db) as typeof db, {
      insert: ((table, row) => {
        if (table === "incidents") throw failure;
        return insert(table, row);
      }) as typeof db.insert,
    });
    const onError = vi.fn();
    const result = runMutation(
      serverMutations,
      "monitor.report",
      {
        id,
        source: "weur",
        at: T + 1000,
        up: false,
        latencyMs: null,
        colo: null,
        httpStatus: null,
        error: "timeout",
        open: open(),
      },
      broken,
      system(T + 1000),
      { onError },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
    // The shard sees the store's own error (a StorageFailure there), so it rolls back and the probe retries.
    expect(onError).toHaveBeenCalledWith(failure, "monitor.report");
    expect(db.get("monitors", id)?.status).toBe("pending");
  });

  test("only a mutation declared silent may succeed without events", () => {
    const refresh = defineMutation({
      name: "test.refresh",
      args: v.object({}),
      permission: "monitor:manage",
      silent: true,
      apply(db) {
        db.insert("counters", { id: "x", value: 1 });
        return ok();
      },
    });
    const db = store();
    const commit = vi.fn();
    const result = runMutation(defineRegistry([refresh]), "test.refresh", {}, db, as("admin"), {
      commit,
    });
    expect(result).toEqual({ ok: true, events: [] });
    expect(commit).toHaveBeenCalledWith([]);
    expect(db.get("counters", "x")).toEqual({ id: "x", value: 1 });
  });
});
