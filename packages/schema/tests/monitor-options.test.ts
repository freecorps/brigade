// The per-monitor options of RFC 0007: quorum and streak length, the incident's severity, status ranges, body
// patterns and request headers, and the workspace's monitor cap. The default rules (a majority, two checks, SEV2)
// are covered in monitors.test.ts; here, what changes when a monitor sets its own, and that rows from before keep
// behaving as they did.
import { describe, expect, test } from "vite-plus/test";
import {
  activeIncidents,
  createMemoryStore,
  evaluateQuery,
  headerProblem,
  MAX_MONITORS_PER_WORKSPACE,
  MONITOR_ACTOR,
  monitorCap,
  monitorCapQuery,
  MONITOR_SETTINGS_ID,
  monitorSettings,
  monitorStatus,
  mutations,
  newId,
  runMutation,
  serverMutations,
  statusExpected,
  type BrigadeTables,
  type MemoryStore,
  type MonitorCheck,
  type MonitorRow,
  type MutationContext,
  type MutationResult,
  type ProbeRegion,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 27, 12, 0, 0);
let seed = 0;
const random = (n: number) => new Uint8Array(n).fill(++seed % 256);

const as = (role: Role, now = T, limits?: MutationContext["limits"]): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now,
  server: true,
  ...(limits && { limits }),
});
const system = (now = T): MutationContext => ({ actor: MONITOR_ACTOR, now, server: true });
const store = () => createMemoryStore<BrigadeTables>();
const types = (result: MutationResult) =>
  result.ok ? result.events.map((event) => event.type) : result.error.code;

const httpArgs = (regions: ProbeRegion[], overrides: object = {}) => ({
  id: newId("mon", T, random),
  name: "Checkout",
  url: "https://example.com/health",
  method: "GET",
  keyword: null,
  intervalSeconds: 60,
  timeoutSeconds: 10,
  regions,
  ...overrides,
});

function createHttp(db: MemoryStore<BrigadeTables>, regions: ProbeRegion[], overrides = {}) {
  const args = httpArgs(regions, overrides);
  const result = runMutation(mutations, "monitor.createHttp", args, db, as("admin"));
  expect(result).toMatchObject({ ok: true });
  return args.id;
}

const open = () => ({
  alertId: newId("alt", T, random),
  incidentId: newId("inc", T, random),
  title: "Checkout is down",
});

function report(
  db: MemoryStore<BrigadeTables>,
  id: string,
  source: string,
  up: boolean,
  at: number,
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
    system(at),
  );
}

const check = (source: ProbeRegion, up: boolean, at = T): MonitorCheck => ({
  source,
  at,
  up,
  latencyMs: null,
  colo: null,
  httpStatus: null,
  error: up ? null : "status",
});

const probed = (
  regions: ProbeRegion[],
  quorum: number | null,
  status: MonitorRow["status"] = "up",
) => ({
  kind: "http" as const,
  regions,
  intervalSeconds: 60,
  status,
  restartedAt: T - 60 * 60 * 1000,
  quorum,
});

describe("quorum: how many regions must agree", () => {
  const three: ProbeRegion[] = ["wnam", "enam", "weur"];

  test("without one it is a majority of the fresh results, as before", () => {
    const monitor = probed(three, null);
    expect(
      monitorStatus(monitor, [check("wnam", false), check("enam", true), check("weur", true)], T),
    ).toBe("up");
    expect(
      monitorStatus(monitor, [check("wnam", false), check("enam", false), check("weur", true)], T),
    ).toBe("down");
  });

  test("1 of 3: one region down is down, and it recovers only when none is", () => {
    const monitor = probed(three, 1);
    const oneDown = [check("wnam", false), check("enam", true), check("weur", true)];
    // Both "1 down" and "1 up" hold: down wins, so a monitor meant to page on any region does.
    expect(monitorStatus(monitor, oneDown, T)).toBe("down");
    expect(monitorStatus({ ...monitor, status: "down" }, oneDown, T)).toBe("down");
    const allUp = [check("wnam", true), check("enam", true), check("weur", true)];
    expect(monitorStatus({ ...monitor, status: "down" }, allUp, T)).toBe("up");
  });

  test("3 of 3: down only when every region agrees, up only when every region agrees", () => {
    const monitor = probed(three, 3);
    const twoDown = [check("wnam", false), check("enam", false), check("weur", true)];
    // Neither side has three: the status holds, whichever it was.
    expect(monitorStatus(monitor, twoDown, T)).toBe("up");
    expect(monitorStatus({ ...monitor, status: "down" }, twoDown, T)).toBe("down");
    const allDown = [check("wnam", false), check("enam", false), check("weur", false)];
    expect(monitorStatus(monitor, allDown, T)).toBe("down");
  });

  test("3 of 3 with one region quiet: the fresh ones decide, so it still pages", () => {
    const monitor = probed(three, 3);
    // One region stopped reporting: the quorum is capped at the two fresh results, and both are down.
    const stale = T - 60 * 60 * 1000;
    const checks = [check("wnam", false), check("enam", false), check("weur", true, stale)];
    expect(monitorStatus(monitor, checks, T)).toBe("down");
    // It recovers the same way, from the two that still report.
    const back = [check("wnam", true), check("enam", true), check("weur", false, stale)];
    expect(monitorStatus({ ...monitor, status: "down" }, back, T)).toBe("up");
    // Split, the status holds.
    const split = [check("wnam", true), check("enam", false), check("weur", false, stale)];
    expect(monitorStatus(monitor, split, T)).toBe("up");
    expect(monitorStatus({ ...monitor, status: "down" }, split, T)).toBe("down");
  });

  test("below the freshness floor it is still no data, whatever the quorum", () => {
    const stale = T - 60 * 60 * 1000;
    // One fresh result of three is below the floor (two): one region never speaks for three.
    const checks = [check("wnam", false), check("enam", false, stale), check("weur", false, stale)];
    expect(monitorStatus(probed(three, 3), checks, T)).toBe("unknown");
    expect(monitorStatus(probed(three, 1), checks, T)).toBe("unknown");
    expect(monitorStatus(probed(three, null), checks, T)).toBe("unknown");
  });

  test("a stored region this deploy no longer probes counts toward nothing", () => {
    // `sam` was dropped from PROBE_REGIONS (spike S2); a row from before may still name it.
    const monitor = probed(["wnam", "enam", "sam" as ProbeRegion], 3);
    const checks = [check("wnam", false), check("enam", false)];
    // Two known regions, both fresh and down: down, though the row's quorum is three.
    expect(monitorStatus(monitor, checks, T)).toBe("down");
    // A result from the removed region is ignored, not counted as fresh.
    const withGone = [check("wnam", false), check("sam" as ProbeRegion, false)];
    expect(monitorStatus(probed(["wnam", "enam", "sam" as ProbeRegion], 2), withGone, T)).toBe(
      "down",
    );
    expect(
      monitorStatus(probed(["wnam", "enam", "eeur", "sam" as ProbeRegion], 3), withGone, T),
    ).toBe("unknown");
    // Only removed regions: no source at all, so never up or down.
    expect(
      monitorStatus(probed(["sam" as ProbeRegion], 1), [check("sam" as ProbeRegion, false)], T),
    ).toBe("unknown");
  });

  test("2 of 4: a split is down", () => {
    const four: ProbeRegion[] = ["wnam", "enam", "weur", "eeur"];
    const split = [
      check("wnam", false),
      check("enam", false),
      check("weur", true),
      check("eeur", true),
    ];
    expect(monitorStatus(probed(four, 2), split, T)).toBe("down");
    // With the majority (3 of 4) the same split changes nothing.
    expect(monitorStatus(probed(four, null), split, T)).toBe("up");
  });

  test("a heartbeat has one source and ignores any quorum", () => {
    const beat = {
      kind: "heartbeat" as const,
      regions: [],
      intervalSeconds: 60,
      status: "up" as const,
      restartedAt: T - 1000,
      quorum: 3,
    };
    const missed: MonitorCheck = { ...check("wnam", false), source: "heartbeat", error: "missed" };
    expect(monitorStatus(beat, [missed], T)).toBe("down");
  });

  test("end to end: 1 of 2 opens an incident on the first region down, at the monitor's severity", () => {
    const db = store();
    const id = createHttp(db, ["enam", "weur"], { quorum: 1, severity: "sev1" });
    expect(types(report(db, id, "enam", true, T + 1000))).toEqual([
      "monitor.checked",
      "monitor.status_changed",
    ]);
    expect(types(report(db, id, "weur", true, T + 2000))).toEqual(["monitor.checked"]);
    const down = report(db, id, "weur", false, T + 3000);
    expect(types(down)).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "incident.declared",
      "alert.fired",
    ]);
    const [incident] = evaluateQuery(activeIncidents, {}, db);
    expect(incident?.severity).toBe("sev1");
    // Still one region down: no second alert, and no recovery.
    expect(types(report(db, id, "enam", true, T + 4000))).toEqual([]);
    expect(db.get("monitors", id)?.status).toBe("down");
    expect(types(report(db, id, "weur", true, T + 5000))).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "alert.resolved",
    ]);
  });

  test("a monitor without a severity opens SEV2, as before", () => {
    const db = store();
    const id = createHttp(db, ["weur"]);
    const row = db.get("monitors", id)!;
    // A row from before severities has none.
    db.update("monitors", id, { ...row, severity: undefined });
    report(db, id, "weur", false, T + 1000);
    report(db, id, "weur", false, T + 2000);
    expect(db.get("monitors", id)?.status).toBe("down");
    expect(evaluateQuery(activeIncidents, {}, db)[0]?.severity).toBe("sev2");
  });
});

describe("create and update", () => {
  test("defaults are stored for a client that sends none of the new fields", () => {
    const db = store();
    const id = createHttp(db, ["weur"], { expectedStatus: 204 });
    const row = db.get("monitors", id)!;
    expect(row).toMatchObject({
      expectedStatus: null,
      expectedStatuses: [{ min: 204, max: 204 }],
      keywordMode: "text",
      headers: [],
      quorum: null,
      consecutiveChecks: null,
      severity: "sev2",
    });
  });

  test("the cross-field rules: quorum within the regions, a pattern the probe can run, ranges in order", () => {
    const db = store();
    const refuse = (overrides: object) =>
      runMutation(
        mutations,
        "monitor.createHttp",
        httpArgs(["enam", "weur"], overrides),
        db,
        as("admin"),
      );
    expect(refuse({ quorum: 3 })).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "quorum" }] },
    });
    expect(refuse({ keyword: "(?<=a)b", keywordMode: "regex" })).toMatchObject({
      ok: false,
      error: { issues: [{ path: "keyword", message: "Lookbehind is not supported" }] },
    });
    // The same text is a fine plain keyword.
    expect(refuse({ keyword: "(?<=a)b" })).toMatchObject({ ok: true });
    expect(refuse({ expectedStatuses: [{ min: 299, max: 200 }] })).toMatchObject({
      ok: false,
      error: { issues: [{ path: "expectedStatuses[0]" }] },
    });
    expect(
      refuse({ expectedStatus: 200, expectedStatuses: [{ min: 200, max: 299 }] }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
    expect(refuse({ consecutiveChecks: 11 })).toMatchObject({ ok: false });
    expect(refuse({ severity: "sev5" })).toMatchObject({ ok: false });
  });

  test("headers: no Host, credentials or runtime headers, no name twice", () => {
    const db = store();
    const create = (headers: object[]) =>
      runMutation(
        mutations,
        "monitor.createHttp",
        httpArgs(["weur"], { headers }),
        db,
        as("admin"),
      );
    expect(create([{ name: "Accept", value: "application/json" }])).toMatchObject({ ok: true });
    for (const name of [
      "Host",
      "Authorization",
      "proxy-authorization",
      "Cookie",
      "X-Api-Key",
      "X-Auth-Token",
      "X-Session",
      "Content-Length",
      "User-Agent",
      "X-Forwarded-For",
      "CF-Connecting-IP",
      "Bad Name",
    ]) {
      expect(create([{ name, value: "x" }]), name).toMatchObject({
        ok: false,
        error: { issues: [{ path: "headers[0]" }] },
      });
    }
    expect(
      create([
        { name: "Accept", value: "a" },
        { name: "accept", value: "b" },
      ]),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ path: "headers[1]", message: "Listed twice" }] },
    });
    expect(headerProblem("X-Tenant", "é")).toBe("Expected printable ASCII");
    expect(
      create(Array.from({ length: 11 }, (_, i) => ({ name: `X-H${i}`, value: "v" }))),
    ).toMatchObject({
      ok: false,
    });
  });

  test("headers that claim another client or route, and names that read like credentials, are refused", () => {
    const set = "This header can't be set on a check";
    const secret = "Headers are visible to every member: credentials can't go in them";
    for (const name of [
      "True-Client-IP",
      "X-Client-IP",
      "X-Originating-IP",
      "Via",
      "X-Forwarded",
      "X-Original-URL",
      "X-Rewrite-URL",
      "X-HTTP-Method-Override",
      "X-HTTP-Method",
      "X-Method-Override",
    ]) {
      expect(headerProblem(name, "x"), name).toBe(set);
      expect(headerProblem(name.toLowerCase(), "x"), name).toBe(set);
    }
    for (const name of [
      "X-Api-Key",
      "X_API_KEY",
      "apikey",
      "X-Access-Key",
      "access_key",
      "X-AccessKey",
      "Ocp-Apim-Subscription-Key",
      "subscriptionkey",
      "X-Hub-Signature",
      "X-Hub-Signature-256",
      "X-Signature",
      "X-Secret",
      "Client_Secret",
      "X-Token",
      "X-Auth",
      "X-Session-Id",
      "sessionid",
      "X-Key",
      "Key",
      "X-Private-Key",
    ]) {
      expect(headerProblem(name, "x"), name).toBe(secret);
    }
    // Ordinary names that only contain the letters of one.
    for (const name of [
      "Accept",
      "Accept-Language",
      "X-Tenant",
      "X-Request-Id",
      "X-Monkey",
      "Keys-Ok",
      "If-None-Match",
    ]) {
      expect(headerProblem(name, "x"), name).toBeNull();
    }
  });

  test("an edit that leaves a new field out keeps the monitor's", () => {
    const db = store();
    const args = httpArgs(["enam", "weur"], {
      quorum: 1,
      consecutiveChecks: 3,
      severity: "sev1",
      keyword: "ok",
      keywordMode: "regex",
      headers: [{ name: "Accept", value: "text/html" }],
      expectedStatuses: [{ min: 200, max: 299 }],
    });
    runMutation(mutations, "monitor.createHttp", args, db, as("admin"));
    // The same monitor as a client from before these fields sends it.
    const older = { ...httpArgs(["enam", "weur"], { keyword: "ok" }), id: args.id };
    // A client from before these fields renames it.
    const renamed = runMutation(
      mutations,
      "monitor.updateHttp",
      { ...older, name: "Shop" },
      db,
      as("admin"),
    );
    expect(types(renamed)).toEqual(["monitor.updated"]);
    expect(db.get("monitors", args.id)).toMatchObject({
      name: "Shop",
      quorum: 1,
      consecutiveChecks: 3,
      severity: "sev1",
      keywordMode: "regex",
      headers: [{ name: "Accept", value: "text/html" }],
      expectedStatuses: [{ min: 200, max: 299 }],
    });
  });

  test("how it alerts changes without a restart; what it checks restarts it", () => {
    const db = store();
    const id = createHttp(db, ["enam", "weur"]);
    report(db, id, "enam", true, T + 1000);
    report(db, id, "weur", true, T + 2000);
    expect(db.get("monitors", id)?.status).toBe("up");
    const base = { ...httpArgs(["enam", "weur"]), id };
    const update = (overrides: object, now: number) =>
      runMutation(mutations, "monitor.updateHttp", { ...base, ...overrides }, db, as("admin", now));
    expect(types(update({ quorum: 1, severity: "sev3", consecutiveChecks: 4 }, T + 3000))).toEqual([
      "monitor.updated",
    ]);
    expect(db.get("monitors", id)).toMatchObject({ status: "up", restartedAt: T });
    expect(types(update({ quorum: 1, severity: "sev3", consecutiveChecks: 4 }, T + 3500))).toBe(
      "conflict",
    );
    for (const [index, target] of [
      { headers: [{ name: "Accept", value: "text/html" }] },
      { expectedStatuses: [{ min: 200, max: 204 }] },
      { keyword: "ok" },
      { keyword: "ok", keywordMode: "regex" },
    ].entries()) {
      const now = T + 10_000 * (index + 1);
      update({ quorum: 1, severity: "sev3", consecutiveChecks: 4, ...target }, now);
      expect(db.get("monitors", id), JSON.stringify(target)).toMatchObject({
        status: "pending",
        restartedAt: now,
      });
    }
  });

  test("a row from before ranges keeps its one status through an edit that does not change it", () => {
    const db = store();
    const id = createHttp(db, ["weur"]);
    const row = db.get("monitors", id)!;
    // As an older shard stored it.
    db.update("monitors", id, {
      ...row,
      expectedStatus: 204,
      expectedStatuses: undefined,
      keywordMode: undefined,
      headers: undefined,
      quorum: undefined,
      consecutiveChecks: undefined,
      severity: undefined,
    });
    expect(monitorSettings(db.get("monitors", id)!)).toMatchObject({
      expectedStatuses: [{ min: 204, max: 204 }],
      keywordMode: "text",
      headers: [],
      quorum: null,
      severity: "sev2",
    });
    const base = { ...httpArgs(["weur"]), id, expectedStatus: 204 };
    // Saved as an older client would, unchanged: nothing to change.
    expect(types(runMutation(mutations, "monitor.updateHttp", base, db, as("admin")))).toBe(
      "conflict",
    );
    // And as the new dashboard sends it, with the defaults spelled out.
    const spelled = {
      ...httpArgs(["weur"]),
      id,
      expectedStatuses: [{ min: 204, max: 204 }],
      keywordMode: "text",
      headers: [],
      quorum: null,
      consecutiveChecks: null,
      severity: "sev2",
    };
    expect(types(runMutation(mutations, "monitor.updateHttp", spelled, db, as("admin")))).toBe(
      "conflict",
    );
    // A rename keeps the stored status as it was, so the probes' config does not change.
    runMutation(mutations, "monitor.updateHttp", { ...spelled, name: "Shop" }, db, as("admin"));
    expect(db.get("monitors", id)).toMatchObject({
      name: "Shop",
      expectedStatus: 204,
      restartedAt: T,
    });
    expect(db.get("monitors", id)?.expectedStatuses ?? null).toBeNull();
  });

  test("TCP and heartbeat monitors take a severity; TCP takes a quorum too", () => {
    const db = store();
    const tcp = {
      id: newId("mon", T, random),
      name: "Database",
      host: "db.example.com",
      port: 5432,
      intervalSeconds: 60,
      timeoutSeconds: 10,
      regions: ["enam", "weur"],
      quorum: 2,
      consecutiveChecks: 1,
      severity: "sev4",
    };
    expect(runMutation(mutations, "monitor.createTcp", tcp, db, as("admin"))).toMatchObject({
      ok: true,
    });
    expect(db.get("monitors", tcp.id)).toMatchObject({
      quorum: 2,
      consecutiveChecks: 1,
      severity: "sev4",
    });
    const beat = {
      id: newId("mon", T, random),
      name: "Nightly",
      intervalSeconds: 3600,
      graceSeconds: 300,
      tokenHash: "a".repeat(64),
      severity: "sev3",
    };
    expect(runMutation(mutations, "monitor.createHeartbeat", beat, db, as("admin"))).toMatchObject({
      ok: true,
    });
    expect(db.get("monitors", beat.id)?.severity).toBe("sev3");
    const { tokenHash: _hash, ...edit } = beat;
    expect(
      types(
        runMutation(
          mutations,
          "monitor.updateHeartbeat",
          { ...edit, severity: "sev1" },
          db,
          as("admin"),
        ),
      ),
    ).toEqual(["monitor.updated"]);
    expect(db.get("monitors", beat.id)?.severity).toBe("sev1");
  });

  test("statusExpected: ranges, or any 2xx and 3xx", () => {
    expect(statusExpected(200, null)).toBe(true);
    expect(statusExpected(302, null)).toBe(true);
    expect(statusExpected(404, null)).toBe(false);
    const ranges = [
      { min: 200, max: 200 },
      { min: 500, max: 599 },
    ];
    expect(statusExpected(503, ranges)).toBe(true);
    expect(statusExpected(204, ranges)).toBe(false);
  });
});

describe("the workspace's monitor cap", () => {
  const withWorkspace = () => {
    const db = store();
    db.insert("workspace", { id: "ws_1", name: "Acme", createdAt: T, createdBy: "usr_ana" });
    return db;
  };
  const fill = (db: MemoryStore<BrigadeTables>, count: number) => {
    for (let i = 0; i < count; i++) createHttp(db, ["weur"], { name: `Check ${i}` });
  };
  const create = (db: MemoryStore<BrigadeTables>, ctx: MutationContext) =>
    runMutation(mutations, "monitor.createHttp", httpArgs(["weur"]), db, ctx);
  const setCap = (db: MemoryStore<BrigadeTables>, cap: number | null, ctx: MutationContext) =>
    runMutation(mutations, "monitor.setCap", { cap }, db, ctx);

  test("only owners set it, at most the instance's cap", () => {
    const db = withWorkspace();
    expect(types(setCap(db, 5, as("admin")))).toBe("forbidden");
    expect(types(setCap(db, 5, as("responder")))).toBe("forbidden");
    expect(setCap(db, 101, as("owner"))).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "cap" }] },
    });
    // A self-hosted instance that allows more.
    expect(types(setCap(db, 500, as("owner", T, { monitors: 1000 })))).toEqual([
      "monitor.cap_changed",
    ]);
    expect(db.get("monitor_settings", MONITOR_SETTINGS_ID)?.cap).toBe(500);
    expect(types(setCap(db, 500, as("owner", T, { monitors: 1000 })))).toBe("conflict");
    expect(types(setCap(db, null, as("owner")))).toEqual(["monitor.cap_changed"]);
    expect(db.get("monitor_settings", MONITOR_SETTINGS_ID)?.cap).toBeNull();
  });

  test("creating past the cap is limit_reached; the monitors past a lowered cap keep running", () => {
    const db = withWorkspace();
    fill(db, 3);
    expect(types(setCap(db, 2, as("owner")))).toEqual(["monitor.cap_changed"]);
    expect(db.scan("monitors")).toHaveLength(3);
    expect(types(create(db, as("admin")))).toBe("limit_reached");
    expect(types(setCap(db, 4, as("owner")))).toEqual(["monitor.cap_changed"]);
    expect(create(db, as("admin"))).toMatchObject({ ok: true });
    expect(types(create(db, as("admin")))).toBe("limit_reached");
  });

  test("the instance's cap applies when it is lower than the workspace's, and defaults to 100", () => {
    const db = withWorkspace();
    expect(types(setCap(db, 50, as("owner")))).toEqual(["monitor.cap_changed"]);
    fill(db, 3);
    // The operator lowered the instance's cap after the owner set theirs.
    expect(types(create(db, as("admin", T, { monitors: 3 })))).toBe("limit_reached");
    expect(monitorCap({ cap: 50 }, 3)).toBe(3);
    expect(monitorCap(undefined, MAX_MONITORS_PER_WORKSPACE)).toBe(100);
  });

  test("a client's optimistic run does not know the instance's cap and leaves it to the shard", () => {
    const db = withWorkspace();
    const client: MutationContext = { ...as("owner"), server: false };
    expect(types(setCap(db, 5000, client))).toEqual(["monitor.cap_changed"]);
  });

  test("monitors.cap reads the settings row alone, never the workspace row", () => {
    const db = withWorkspace();
    db.update("workspace", "ws_1", { email: { unpaged: false, nobodyPaged: true } });
    expect(evaluateQuery(monitorCapQuery, {}, db)).toEqual([]);
    expect(types(setCap(db, 20, as("owner")))).toEqual(["monitor.cap_changed"]);
    expect(evaluateQuery(monitorCapQuery, {}, db)).toEqual([{ id: MONITOR_SETTINGS_ID, cap: 20 }]);
  });
});
