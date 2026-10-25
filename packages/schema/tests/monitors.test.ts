import { describe, expect, test } from "vite-plus/test";
import {
  activeIncidents,
  createMemoryStore,
  evaluateQuery,
  MONITOR_ACTOR,
  monitorSources,
  mutations,
  newId,
  queries,
  quorum,
  quorumStatus,
  runMutation,
  serverMutations,
  targetProblem,
  v,
  type BrigadeTables,
  type MemoryStore,
  type MonitorCheck,
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

function report(
  db: MemoryStore<BrigadeTables>,
  id: string,
  source: string,
  up: boolean,
  at = T + 1000,
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
      open: {
        alertId: newId("alt", T, random),
        incidentId: newId("inc", T, random),
        title: "Checkout is down",
      },
    },
    db,
    system(at),
  );
}

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
      "http://example.com:8080/",
      "https://93.184.215.14/",
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

describe("quorum", () => {
  const check = (source: ProbeRegion, up: boolean): MonitorCheck => ({
    source,
    at: T,
    up,
    latencyMs: null,
    colo: null,
    httpStatus: null,
    error: null,
  });

  test("one region is its own quorum; N regions need a majority", () => {
    expect([1, 2, 3, 4, 5, 6].map(quorum)).toEqual([1, 2, 2, 3, 3, 4]);
  });

  test("down or up takes a quorum; otherwise the status holds", () => {
    const sources: ProbeRegion[] = ["wnam", "weur", "apac"];
    expect(quorumStatus(sources, [check("wnam", false)], "up")).toBe("up");
    expect(quorumStatus(sources, [check("wnam", false), check("weur", false)], "up")).toBe("down");
    expect(quorumStatus(sources, [check("wnam", true), check("weur", false)], "down")).toBe("down");
    expect(quorumStatus(sources, [check("wnam", true), check("weur", true)], "down")).toBe("up");
    expect(quorumStatus(sources, [], "pending")).toBe("pending");
    // A result from a region the monitor no longer uses does not count.
    expect(quorumStatus(["wnam"], [check("weur", false)], "up")).toBe("up");
  });

  test("a heartbeat monitor has one source", () => {
    expect(monitorSources({ kind: "heartbeat", regions: [] })).toEqual(["heartbeat"]);
    expect(monitorSources({ kind: "http", regions: ["enam", "oc"] })).toEqual(["enam", "oc"]);
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
      createdBy: "usr_ana",
    });

    const same = runMutation(mutations, "monitor.updateHttp", args, db, as("admin"));
    expect(same).toMatchObject({ ok: false, error: { code: "conflict" } });
    const renamed = { ...args, name: "Checkout API" };
    expect(types(runMutation(mutations, "monitor.updateHttp", renamed, db, as("admin")))).toEqual([
      "monitor.updated",
    ]);

    const pause = { id: args.id, paused: true };
    expect(types(runMutation(mutations, "monitor.setPaused", pause, db, as("admin")))).toEqual([
      "monitor.paused",
    ]);
    expect(runMutation(mutations, "monitor.setPaused", pause, db, as("admin")).ok).toBe(false);
    const resume = { id: args.id, paused: false };
    expect(types(runMutation(mutations, "monitor.setPaused", resume, db, as("admin")))).toEqual([
      "monitor.resumed",
    ]);
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
    const result = runMutation(mutations, "monitor.report" as never, { id }, db, as("owner"));
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_mutation" } });
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
    expect(types(down)).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "alert.fired",
      "incident.declared",
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

    // Still down: deduplicated, no second alert or incident.
    expect(types(report(db, id, "weur", false, T + 3000))).toEqual(["monitor.checked"]);
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
