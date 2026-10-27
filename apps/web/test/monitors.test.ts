import { m } from "@freecorps/brigade-i18n";
import {
  newId,
  parseHeartbeatToken,
  REPORT_EVERY_MS,
  type MonitorCheck,
  type MonitorRow,
  type ProbeRegion,
} from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import {
  checkDraft,
  checkEdit,
  checkErrorReason,
  draftChanged,
  rebaseDraft,
  draftFromRow,
  editRestarts,
  EMPTY_DRAFT,
  formatLatency,
  formatSeconds,
  formatStatuses,
  monitorActions,
  monitorBadge,
  monitorPolicy,
  monitorRefusal,
  monitorsFull,
  newHeartbeat,
  parseStatuses,
  pausedBy,
  refusedHeaderRows,
  sourceChips,
  stalledRegions,
  stalePolicy,
  splitHostPort,
  tcpFieldReason,
  tcpHostLabel,
  workspaceMonitorCap,
} from "../src/lib/monitors";

const id = () => newId("mon", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));

test("a paused monitor reads as paused, whatever its last status", () => {
  expect(monitorBadge({ paused: true, status: "down" })).toBe("paused");
  expect(monitorBadge({ paused: false, status: "down" })).toBe("down");
  expect(monitorBadge({ paused: false, status: "unknown" })).toBe("unknown");
  expect(m.monitor_status({ status: "unknown" }, { locale: "en" })).toBe("No data");
  expect(m.monitor_status({ status: "unknown" }, { locale: "pt-BR" })).toBe("Sem dados");
});

test("each configured source is a chip: fresh, stale (no data) or waiting", () => {
  const now = Date.UTC(2026, 9, 25, 12);
  const check = (source: MonitorCheck["source"], at: number): MonitorCheck => ({
    source,
    at,
    up: true,
    latencyMs: 80,
    colo: "IAD",
    httpStatus: 200,
    error: null,
  });
  const chips = sourceChips(
    {
      kind: "http",
      regions: ["wnam", "enam", "weur"],
      intervalSeconds: 60,
      checks: [check("enam", now - 1000), check("wnam", now - 2 * REPORT_EVERY_MS - 1)],
    },
    now,
  );
  expect(chips.map((chip) => [chip.source, chip.state])).toEqual([
    ["wnam", "stale"],
    ["enam", "fresh"],
    ["weur", "waiting"],
  ]);
});

test("a failed check says why, in both locales", () => {
  const text = (
    error: string,
    httpStatus: number | null,
    expected: number | null,
    locale: "en" | "pt-BR",
  ) =>
    m.monitor_check_error(
      {
        reason: checkErrorReason(
          { error },
          expected === null ? null : [{ min: expected, max: expected }],
        ),
        got: String(httpStatus ?? ""),
        expected: String(expected ?? ""),
      },
      { locale },
    );
  expect(text("status", 200, 418, "en")).toBe("Got 200, expected 418");
  expect(text("status", 503, null, "en")).toBe("Got 503, expected 2xx or 3xx");
  expect(text("status", 503, null, "pt-BR")).toBe("Recebeu 503, esperava 2xx ou 3xx");
  expect(text("timeout", null, null, "en")).toBe("Timed out");
  expect(text("network", null, null, "en")).toBe("Couldn't connect");
  expect(text("blocked", null, null, "en")).toBe("Address not allowed");
  expect(text("keyword", 200, null, "en")).toBe("Text not found");
  expect(text("missed", null, null, "pt-BR")).toBe("Nenhum sinal a tempo");
});

test("intervals and latencies in both locales", () => {
  expect([30, 90, 300, 3600, 86_400].map((s) => formatSeconds(s, "en"))).toEqual([
    "30 sec",
    "90 sec",
    "5 min",
    "1 hr",
    "1 day",
  ]);
  expect(formatSeconds(300, "pt-BR")).toBe("5 min");
  expect(formatLatency(1284, "en")).toBe("1,284 ms");
  expect(formatLatency(1284, "pt-BR")).toBe("1.284 ms");
});

test("an HTTP draft becomes createHttp's args, checked by its own validator", () => {
  const checked = checkDraft(
    { ...EMPTY_DRAFT, name: " Checkout ", url: "https://example.com" },
    id(),
  );
  expect(checked).toMatchObject({
    ok: true,
    kind: "http",
    args: {
      name: "Checkout",
      url: "https://example.com/",
      expectedStatuses: null,
      keyword: null,
      keywordMode: "text",
      headers: [],
      intervalSeconds: 60,
      timeoutSeconds: 10,
      regions: ["enam", "weur"],
      quorum: null,
      consecutiveChecks: null,
      severity: "sev2",
    },
  });
  // The one status of clients from before ranges is left out (`undefined` never goes over the wire).
  expect(checked.ok && checked.kind === "http" && checked.args.expectedStatus).toBeUndefined();
});

test("expected statuses read as a list of statuses and ranges, and back", () => {
  expect(parseStatuses("")).toBeNull();
  expect(parseStatuses(" 200, 204 500-599 ")).toEqual([
    { min: 200, max: 200 },
    { min: 204, max: 204 },
    { min: 500, max: 599 },
  ]);
  expect(parseStatuses("200;301–302")).toEqual([
    { min: 200, max: 200 },
    { min: 301, max: 302 },
  ]);
  expect(parseStatuses("2xx")).toBeUndefined();
  expect(parseStatuses("200-")).toBeUndefined();
  expect(
    formatStatuses([
      { min: 200, max: 200 },
      { min: 500, max: 599 },
    ]),
  ).toBe("200, 500-599");
  expect(formatStatuses(null)).toBe("");
  const draft = { ...EMPTY_DRAFT, name: "API", url: "https://example.com" };
  expect(checkDraft({ ...draft, expectedStatus: "2xx" }, id())).toEqual({
    ok: false,
    fields: ["expectedStatus"],
  });
  // A range out of order, and a status out of range.
  expect(checkDraft({ ...draft, expectedStatus: "299-200" }, id())).toEqual({
    ok: false,
    fields: ["expectedStatus"],
  });
  expect(checkDraft({ ...draft, expectedStatus: "700" }, id())).toEqual({
    ok: false,
    fields: ["expectedStatus"],
  });
  expect(checkDraft({ ...draft, expectedStatus: "200, 404" }, id())).toMatchObject({
    ok: true,
    args: {
      expectedStatuses: [
        { min: 200, max: 200 },
        { min: 404, max: 404 },
      ],
    },
  });
});

test("a pattern is checked with the probe's own rules; a catastrophic one still compiles and runs", () => {
  const draft = { ...EMPTY_DRAFT, name: "API", url: "https://example.com" };
  expect(
    checkDraft({ ...draft, keyword: '"status":\\s*"ok"', keywordMode: "regex" }, id()),
  ).toMatchObject({ ok: true, args: { keywordMode: "regex" } });
  expect(checkDraft({ ...draft, keyword: "(?<=a)b", keywordMode: "regex" }, id())).toEqual({
    ok: false,
    fields: ["keyword"],
  });
  expect(checkDraft({ ...draft, keyword: "(a)\\1", keywordMode: "regex" }, id())).toEqual({
    ok: false,
    fields: ["keyword"],
  });
  // As plain text the same characters are fine.
  expect(checkDraft({ ...draft, keyword: "(?<=a)b" }, id())).toMatchObject({ ok: true });
  expect(checkDraft({ ...draft, keyword: "(a+)+$", keywordMode: "regex" }, id())).toMatchObject({
    ok: true,
  });
});

test("headers: empty rows are dropped, credentials and duplicates are refused by row", () => {
  const draft = { ...EMPTY_DRAFT, name: "API", url: "https://example.com" };
  const headers = [
    { name: "Accept", value: "application/json" },
    { name: "", value: "" },
    { name: "X-Tenant", value: "acme" },
  ];
  expect(checkDraft({ ...draft, headers }, id())).toMatchObject({
    ok: true,
    args: {
      headers: [
        { name: "Accept", value: "application/json" },
        { name: "X-Tenant", value: "acme" },
      ],
    },
  });
  const bad = [
    { name: "Authorization", value: "Bearer x" },
    { name: "Accept", value: "text/html" },
    { name: "accept", value: "text/plain" },
    { name: "X-Api-Key", value: "x" },
    { name: "Host", value: "example.org" },
    { name: "Cookie", value: "a=b" },
    { name: "X-Name", value: "" },
  ];
  expect(checkDraft({ ...draft, headers: bad }, id())).toEqual({ ok: false, fields: ["headers"] });
  expect(refusedHeaderRows({ headers: bad })).toEqual([0, 2, 3, 4, 5, 6]);
});

test("quorum and streak: within the regions, and left empty for the defaults", () => {
  const draft = { ...EMPTY_DRAFT, name: "API", url: "https://example.com" };
  expect(
    checkDraft({ ...draft, quorum: "2", consecutiveChecks: "3", severity: "sev1" }, id()),
  ).toMatchObject({ ok: true, args: { quorum: 2, consecutiveChecks: 3, severity: "sev1" } });
  // Two regions ticked: a quorum of three cannot be met.
  expect(checkDraft({ ...draft, quorum: "3" }, id())).toEqual({ ok: false, fields: ["quorum"] });
  expect(checkDraft({ ...draft, consecutiveChecks: "11" }, id())).toEqual({
    ok: false,
    fields: ["consecutiveChecks"],
  });
  expect(
    checkDraft(
      {
        ...EMPTY_DRAFT,
        kind: "tcp",
        name: "DB",
        host: "db.example.com",
        port: "5432",
        quorum: "1",
      },
      id(),
    ),
  ).toMatchObject({ ok: true, args: { quorum: 1 } });
});

test("the fields the shard would refuse are named, a private URL among them", () => {
  const checked = checkDraft(
    {
      ...EMPTY_DRAFT,
      name: "",
      url: "http://192.168.1.1/",
      expectedStatus: "abc",
      intervalSeconds: "10",
      regions: [],
    },
    id(),
  );
  expect(checked.ok ? [] : [...checked.fields].sort()).toEqual(
    ["expectedStatus", "intervalSeconds", "name", "regions", "url"].sort(),
  );
  const slow = checkDraft(
    {
      ...EMPTY_DRAFT,
      name: "A",
      url: "https://example.com",
      intervalSeconds: "30",
      timeoutSeconds: "30",
    },
    id(),
  );
  expect(slow.ok).toBe(true);
  // A timeout longer than the interval is named even when another field is wrong too.
  const both = checkDraft(
    {
      ...EMPTY_DRAFT,
      name: "",
      url: "https://example.com",
      intervalSeconds: "30",
      timeoutSeconds: "31",
    },
    id(),
  );
  expect(both.ok ? [] : [...both.fields].sort()).toEqual(["name", "timeoutSeconds"]);
  const longer = checkDraft(
    {
      ...EMPTY_DRAFT,
      name: "A",
      url: "https://example.com",
      intervalSeconds: "30",
      timeoutSeconds: "20",
    },
    id(),
  );
  expect(longer.ok).toBe(true);
  expect(m.monitor_field_invalid({ field: "regions" }, { locale: "en" })).toBe(
    "Pick at least one region.",
  );
  // A keyword is dropped for HEAD, which has no body.
  const head = checkDraft(
    { ...EMPTY_DRAFT, name: "A", url: "https://example.com", method: "HEAD", keyword: "ok" },
    id(),
  );
  expect(head).toMatchObject({ ok: true, args: { method: "HEAD", keyword: null } });
});

test("a TCP draft becomes createTcp's args; a private host, port 25 and a host with a port are refused", () => {
  const tcp = { ...EMPTY_DRAFT, kind: "tcp" as const, name: "Database" };
  expect(checkDraft({ ...tcp, host: " DB.Example.com ", port: "5432" }, id())).toMatchObject({
    ok: true,
    kind: "tcp",
    args: { host: "db.example.com", port: 5432, timeoutSeconds: 10, regions: ["enam", "weur"] },
  });
  const fields = (draft: object) => {
    const checked = checkDraft({ ...tcp, ...draft }, id());
    return checked.ok ? [] : [...checked.fields].sort();
  };
  // The SSRF rules of HTTP checks, through the schema's own `tcpTargetProblems`.
  expect(fields({ host: "10.0.0.5", port: "5432" })).toEqual(["host"]);
  expect(fields({ host: "169.254.169.254", port: "80" })).toEqual(["host"]);
  expect(fields({ host: "localhost", port: "22" })).toEqual(["host"]);
  expect(fields({ host: "db.example.com:5432", port: "5432" })).toEqual(["host"]);
  expect(fields({ host: "https://example.com", port: "443" })).toEqual(["host"]);
  expect(fields({ host: "example.com", port: "25" })).toEqual(["port"]);
  expect(fields({ host: "example.com", port: "70000" })).toEqual(["port"]);
  expect(fields({ host: "", port: "" })).toEqual(["host", "port"]);
  // Both at once: a private host and port 25 are each named.
  expect(fields({ host: "10.0.0.5", port: "25" })).toEqual(["host", "port"]);
  // The timeout rule holds for TCP too, named alongside another refused field.
  expect(
    fields({ host: "10.0.0.5", port: "22", intervalSeconds: "30", timeoutSeconds: "31" }),
  ).toEqual(["host", "timeoutSeconds"]);
  expect(fields({ host: "example.com", port: "22", regions: [] })).toEqual(["regions"]);
  // Cloudflare's own addresses, which connect() never reaches.
  expect(fields({ host: "104.16.0.1", port: "443" })).toEqual(["host"]);
  expect(m.monitor_field_invalid({ field: "port" }, { locale: "pt-BR" })).toBe(
    "Use uma porta de 1 a 65535.",
  );
});

test("a refused TCP port or host has its own wording when Cloudflare or an underscore is the reason", () => {
  const tcp = { kind: "tcp" as const, host: "db.example.com", port: "5432" };
  expect(tcpFieldReason("port", { ...tcp, port: "25" })).toBe("port_blocked");
  expect(tcpFieldReason("port", { ...tcp, port: "70000" })).toBeNull();
  expect(tcpFieldReason("host", { ...tcp, host: " 104.16.0.1 " })).toBe("host_cloudflare");
  expect(tcpFieldReason("host", { ...tcp, host: "[2606:4700::1111]" })).toBe("host_cloudflare");
  expect(tcpFieldReason("host", { ...tcp, host: "10.0.0.5" })).toBeNull();
  expect(tcpFieldReason("host", { ...tcp, host: "db_1.example.com" })).toBe("host_underscore");
  expect(tcpFieldReason("port", { ...tcp, kind: "http", port: "25" })).toBeNull();
  for (const locale of ["en", "pt-BR"] as const) {
    for (const field of ["port_blocked", "host_cloudflare", "host_underscore"]) {
      expect(m.monitor_field_invalid({ field }, { locale })).not.toBe(
        m.monitor_field_invalid({ field: "other" }, { locale }),
      );
    }
  }
  expect(m.monitor_field_invalid({ field: "port_blocked" })).toBe(
    "Cloudflare blocks port 25. Use another port.",
  );
});

test("a pasted host:port or URL splits into host and port; a bare host pastes as typed", () => {
  expect(splitHostPort("db.example.com:5432")).toEqual({ host: "db.example.com", port: "5432" });
  expect(splitHostPort(" postgres://db.example.com:5432/app?ssl=1 ")).toEqual({
    host: "db.example.com",
    port: "5432",
  });
  expect(splitHostPort("[2001:db8::1]:22")).toEqual({ host: "2001:db8::1", port: "22" });
  expect(splitHostPort("https://example.com/health")).toEqual({ host: "example.com", port: null });
  expect(splitHostPort("db.example.com")).toBeNull();
  expect(splitHostPort("2001:db8::1")).toBeNull();
  expect(splitHostPort("not a host:22")).toBeNull();
});

test("a pasted connection string fills in its host and port, never its credentials", () => {
  for (const [text, host, port] of [
    ["postgres://admin:hunter2@db.example.com:5432/app", "db.example.com", "5432"],
    ["redis://:hunter2@cache.example.com:6379", "cache.example.com", "6379"],
    // An unescaped `@` in the password: everything up to the last one before the path is credentials.
    ["mysql://admin:hun@ter2@db.example.com:3306/app?ssl=true", "db.example.com", "3306"],
    ["amqp://admin@[2001:db8::1]:5672", "2001:db8::1", "5672"],
  ] as const) {
    const split = splitHostPort(text);
    expect(split).toEqual({ host, port });
    expect(JSON.stringify(split)).not.toMatch(/hunter2|hun@ter2|admin/);
  }
});

test("a TCP host reads as itself before its port, an IPv6 address in brackets", () => {
  expect(tcpHostLabel({ host: "db.example.com" })).toBe("db.example.com");
  expect(tcpHostLabel({ host: "2001:db8::10" })).toBe("[2001:db8::10]");
});

test("a heartbeat URL carries the workspace, the monitor and a secret whose hash is sent", async () => {
  const monitorId = id();
  const { tokenHash, url } = await newHeartbeat(
    "https://brigade.example.com",
    "ws_demo",
    monitorId,
  );
  expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  const prefix = "https://brigade.example.com/api/heartbeat/";
  expect(url.startsWith(prefix)).toBe(true);
  const parsed = parseHeartbeatToken(url.slice(prefix.length));
  expect(parsed).toMatchObject({ workspaceId: "ws_demo", monitorId });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parsed!.secret));
  expect([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(
    tokenHash,
  );
  expect(checkDraft({ ...EMPTY_DRAFT, kind: "heartbeat", name: "Backup" }, id())).toMatchObject({
    ok: true,
    kind: "heartbeat",
    args: { intervalSeconds: 60, graceSeconds: 300 },
  });
});

const row = (overrides: Partial<MonitorRow> = {}): MonitorRow => ({
  id: id(),
  name: "Checkout",
  kind: "http",
  url: "https://example.com/health",
  method: "GET",
  expectedStatus: null,
  keyword: null,
  host: null,
  port: null,
  timeoutSeconds: 10,
  regions: ["enam", "weur"],
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
  createdBy: "usr_dev",
  updatedAt: 0,
  ...overrides,
});

test("owners and admins can edit and pause or resume (Delete is in the edit form); others only read", () => {
  expect(monitorActions("owner", { paused: false })).toEqual(["edit", "pause"]);
  expect(monitorActions("admin", { paused: true })).toEqual(["edit", "resume"]);
  expect(monitorActions("responder", { paused: false })).toEqual([]);
  expect(monitorActions("viewer", { paused: true })).toEqual([]);
});

test("the edit form opens with the monitor's values, and an untouched one changes nothing", () => {
  const http = row({ expectedStatus: 204, keyword: "ok" });
  const draft = draftFromRow(http);
  expect(draft).toMatchObject({
    kind: "http",
    name: "Checkout",
    url: "https://example.com/health",
    expectedStatus: "204",
    keyword: "ok",
    intervalSeconds: "60",
    timeoutSeconds: "10",
  });
  // Regions picked in another order are the same regions (the shard keeps `PROBE_REGIONS` order).
  expect(checkEdit({ ...draft, regions: ["weur", "enam"] }, http)).toMatchObject({
    ok: true,
    changed: false,
  });

  const heartbeat = row({
    kind: "heartbeat",
    url: null,
    method: null,
    timeoutSeconds: null,
    regions: [],
    graceSeconds: 120,
  });
  const beat = draftFromRow(heartbeat);
  expect(beat).toMatchObject({ kind: "heartbeat", graceSeconds: "120" });
  expect(checkEdit(beat, heartbeat)).toEqual({
    ok: true,
    kind: "heartbeat",
    changed: false,
    args: {
      id: heartbeat.id,
      name: "Checkout",
      intervalSeconds: 60,
      graceSeconds: 120,
      severity: "sev2",
    },
  });
  // No token hash in a heartbeat's update: its URL stays as it was.
  expect(checkEdit({ ...beat, name: "Nightly backup" }, heartbeat)).toMatchObject({
    ok: true,
    changed: true,
    args: { name: "Nightly backup" },
  });
});

test("an edit is checked like a new monitor, and the kind never changes", () => {
  const http = row();
  const draft = draftFromRow(http);
  expect(checkEdit({ ...draft, name: "", url: "http://localhost/" }, http)).toEqual({
    ok: false,
    fields: ["name", "url"],
  });
  expect(checkEdit({ ...draft, timeoutSeconds: "90" }, http)).toEqual({
    ok: false,
    fields: ["timeoutSeconds"],
  });
  expect(checkEdit({ ...draft, regions: [] }, http)).toEqual({ ok: false, fields: ["regions"] });
  // A draft that says heartbeat is still checked as the HTTP monitor it edits.
  expect(checkEdit({ ...draft, kind: "heartbeat", name: "Renamed" }, http)).toMatchObject({
    ok: true,
    kind: "http",
    changed: true,
  });
});

test("only a change to what is checked, on a running HTTP monitor, starts it over", () => {
  const http = row();
  const draft = draftFromRow(http);
  expect(editRestarts({ ...draft, name: "Renamed", intervalSeconds: "120" }, http)).toBe(false);
  expect(editRestarts({ ...draft, url: "https://example.com/ready" }, http)).toBe(true);
  expect(editRestarts({ ...draft, regions: ["enam"] }, http)).toBe(true);
  expect(editRestarts({ ...draft, keyword: "ok" }, http)).toBe(true);
  // Paused, it starts over on resume anyway; invalid, nothing is sent.
  expect(editRestarts({ ...draft, url: "https://example.com/ready" }, row({ paused: true }))).toBe(
    false,
  );
  expect(editRestarts({ ...draft, url: "not a url" }, http)).toBe(false);
});

test("a TCP monitor edits like an HTTP one: its own update, restarting on a new host, port or timeout", () => {
  const tcp = row({
    kind: "tcp",
    name: "Database",
    url: null,
    method: null,
    host: "db.example.com",
    port: 5432,
  });
  const draft = draftFromRow(tcp);
  expect(draft).toMatchObject({ kind: "tcp", host: "db.example.com", port: "5432" });
  expect(checkEdit(draft, tcp)).toMatchObject({ ok: true, kind: "tcp", changed: false });
  expect(checkEdit({ ...draft, name: "Primary" }, tcp)).toMatchObject({
    ok: true,
    kind: "tcp",
    args: { id: tcp.id, name: "Primary", host: "db.example.com", port: 5432 },
    changed: true,
  });
  expect(checkEdit({ ...draft, port: "25" }, tcp)).toEqual({ ok: false, fields: ["port"] });
  expect(editRestarts({ ...draft, name: "Primary", intervalSeconds: "120" }, tcp)).toBe(false);
  expect(editRestarts({ ...draft, port: "5433" }, tcp)).toBe(true);
  expect(editRestarts({ ...draft, host: "db2.example.com" }, tcp)).toBe(true);
  expect(editRestarts({ ...draft, timeoutSeconds: "5" }, tcp)).toBe(true);
  expect(editRestarts({ ...draft, port: "5433" }, { ...tcp, paused: true })).toBe(false);
});

test("a refused monitor change uses the shared wording, except a monitor that is gone", () => {
  expect(monitorRefusal("forbidden", 100, "en")).toBe(m.sync_error_forbidden());
  expect(monitorRefusal("conflict", 100, "en")).toBe(m.sync_error_conflict());
  expect(monitorRefusal("not_found", 100, "en")).toBe("It was deleted.");
  expect(monitorRefusal("limit_reached", 100, "en")).toBe(
    "This workspace has 100 monitors, the most it can have. Delete one to add another.",
  );
  // The workspace's own cap, in the reader's number format.
  expect(monitorRefusal("limit_reached", 2500, "en")).toBe(
    "This workspace has 2,500 monitors, the most it can have. Delete one to add another.",
  );
  expect(monitorsFull(99)).toBe(false);
  expect(monitorsFull(100)).toBe(true);
  expect(monitorsFull(20, 20)).toBe(true);
  expect(monitorsFull(19, 20)).toBe(false);
  expect(m.monitor_gone({}, { locale: "pt-BR" })).toBe("Ele foi excluído.");
});

test("a draft has changes once it differs from what it opened with; region order does not count", () => {
  const initial = draftFromRow(row({}));
  expect(draftChanged(initial, initial)).toBe(false);
  expect(draftChanged({ ...initial, name: `${initial.name} API` }, initial)).toBe(true);
  expect(draftChanged({ ...initial, regions: [...initial.regions].reverse() }, initial)).toBe(
    false,
  );
  expect(draftChanged({ ...initial, regions: initial.regions.slice(1) }, initial)).toBe(true);
  expect(draftChanged(EMPTY_DRAFT, EMPTY_DRAFT)).toBe(false);
  expect(draftChanged({ ...EMPTY_DRAFT, kind: "heartbeat" }, EMPTY_DRAFT)).toBe(true);
});

test("saving an edit keeps a teammate's change to another field made while the form was open", () => {
  const opened = row();
  const initial = draftFromRow(opened);
  // Here: only the interval. Meanwhile a teammate renamed it and moved its URL.
  const draft = { ...initial, intervalSeconds: "120" };
  const live = row({ name: "Checkout API", url: "https://example.com/ready" });
  const checked = checkEdit(rebaseDraft(draft, initial, live), live);
  expect(checked).toMatchObject({
    ok: true,
    changed: true,
    args: { name: "Checkout API", url: "https://example.com/ready", intervalSeconds: 120 },
  });
  // Regions picked again in another order are not an edit, so the live ones stay.
  const regions = rebaseDraft({ ...initial, regions: [...initial.regions].reverse() }, initial, {
    ...live,
    regions: ["enam"],
  });
  expect(regions.regions).toEqual(["enam"]);
});

const ESC = "esc_01JB0000000000000000000001";
const ESC2 = "esc_01JB0000000000000000000002";

test("a monitor's escalation policy: its own, the default, or none; picked and saved through the form", () => {
  const policies = [
    { id: ESC, name: "Checkout", isDefault: true },
    { id: ESC2, name: "Payments", isDefault: false },
  ];
  expect(monitorPolicy({ policyId: ESC2 }, policies)).toEqual({ kind: "own", name: "Payments" });
  // Rows from before policies per monitor, and a policy this client no longer has, read as the default.
  expect(monitorPolicy({}, policies)).toEqual({ kind: "default", name: "Checkout" });
  expect(monitorPolicy({ policyId: "esc_01JB0000000000000000000009" }, policies)).toEqual({
    kind: "default",
    name: "Checkout",
  });
  expect(monitorPolicy({ policyId: null }, [])).toEqual({ kind: "none" });
  expect(m.monitor_policy({ kind: "own", name: "Payments" }, { locale: "pt-BR" })).toBe(
    "Chama pela política Payments",
  );

  expect(
    checkDraft({ ...EMPTY_DRAFT, name: "API", url: "https://example.com" }, id()),
  ).toMatchObject({ ok: true, args: { policyId: null } });
  const http = row();
  expect(draftFromRow(http).policyId).toBe("");
  const picked = checkEdit({ ...draftFromRow(http), policyId: ESC2 }, http);
  expect(picked).toMatchObject({ ok: true, changed: true, args: { policyId: ESC2 } });
  // A policy change is not a new target: the checks do not start over.
  expect(editRestarts({ ...draftFromRow(http), policyId: ESC2 }, http)).toBe(false);
  const own = row({ policyId: ESC2 });
  expect(checkEdit(draftFromRow(own), own)).toMatchObject({ ok: true, changed: false });
  // Left alone, the policy is not sent: the shard keeps the monitor's.
  const renamed = checkEdit({ ...draftFromRow(own), name: "Renamed" }, own);
  expect(renamed).toMatchObject({ ok: true, changed: true });
  expect(renamed.ok && renamed.args).not.toHaveProperty("policyId");
  expect(checkEdit({ ...draftFromRow(own), policyId: "" }, own)).toMatchObject({
    ok: true,
    changed: true,
    args: { policyId: null },
  });
  const beat = row({ kind: "heartbeat", url: null, method: null, regions: [], graceSeconds: 300 });
  expect(checkEdit({ ...draftFromRow(beat), policyId: ESC }, beat)).toMatchObject({
    ok: true,
    kind: "heartbeat",
    changed: true,
    args: { policyId: ESC },
  });
  expect(
    checkDraft({ ...EMPTY_DRAFT, name: "API", url: "https://example.com", policyId: "nope" }, id()),
  ).toMatchObject({ ok: false, fields: ["policyId"] });
});

test("only a policy that would be sent and is gone blocks the save", () => {
  const policies = [{ id: ESC }];
  const GONE = "esc_01JB0000000000000000000009";
  // A new monitor naming a deleted policy.
  expect(stalePolicy({ policyId: GONE }, null, policies)).toBe(true);
  expect(stalePolicy({ policyId: "" }, null, policies)).toBe(false);
  expect(stalePolicy({ policyId: ESC }, null, policies)).toBe(false);
  // An edit that left the policy alone sends the live row's, which is never sent: not blocked, even when this
  // client has not caught up with that policy (or the draft opened on an older one the row has moved off).
  const own = row({ policyId: GONE });
  const initial = draftFromRow(row({ policyId: ESC2 }));
  const sent = rebaseDraft({ ...initial, name: "Renamed" }, initial, own);
  expect(sent.policyId).toBe(GONE);
  expect(stalePolicy(sent, own, policies)).toBe(false);
  // Picking it again by hand, on a monitor that moved off it, is.
  expect(stalePolicy({ policyId: GONE }, row({ policyId: null }), policies)).toBe(true);
});

test("a row from before the new settings opens with their defaults, and saving it untouched changes nothing", () => {
  // A single expected status, no keyword mode, headers, quorum, streak or severity: what older rows hold.
  const old = row({ expectedStatus: 204 });
  const draft = draftFromRow(old);
  expect(draft).toMatchObject({
    expectedStatus: "204",
    keywordMode: "text",
    headers: [],
    quorum: "",
    consecutiveChecks: "",
    severity: "sev2",
  });
  expect(checkEdit(draft, old)).toMatchObject({ ok: true, changed: false });
  expect(editRestarts(draft, old)).toBe(false);
  // What is checked starts it over; how it alerts does not.
  expect(editRestarts({ ...draft, expectedStatus: "204, 304" }, old)).toBe(true);
  expect(editRestarts({ ...draft, keyword: "ok", keywordMode: "regex" }, old)).toBe(true);
  expect(editRestarts({ ...draft, headers: [{ name: "Accept", value: "text/html" }] }, old)).toBe(
    true,
  );
  for (const change of [
    { severity: "sev1" as const },
    { quorum: "1" },
    { consecutiveChecks: "3" },
  ]) {
    expect(checkEdit({ ...draft, ...change }, old)).toMatchObject({ ok: true, changed: true });
    expect(editRestarts({ ...draft, ...change }, old)).toBe(false);
  }
});

test("an edited header list is kept over the live row; untouched, the live one wins", () => {
  const live = row({ headers: [{ name: "Accept", value: "text/html" }] });
  const initial = draftFromRow(row({}));
  // A teammate added a header while this form was open; this one only renamed the monitor.
  expect(rebaseDraft({ ...initial, name: "Renamed" }, initial, live).headers).toEqual([
    { name: "Accept", value: "text/html" },
  ]);
  const edited = { ...initial, headers: [{ name: "X-Tenant", value: "acme" }] };
  expect(rebaseDraft(edited, initial, live).headers).toEqual([{ name: "X-Tenant", value: "acme" }]);
});

test("Paused by names the member from the shard's list, and falls back when it has no name", () => {
  const members = [
    { id: "usr_ana", name: "Ana Souza" },
    { id: "usr_unnamed", name: null },
  ];
  expect(pausedBy({ pausedBy: "usr_me" }, "usr_me", members)).toEqual({
    state: "paused_you",
    name: "",
  });
  expect(pausedBy({ pausedBy: "usr_ana" }, "usr_me", members)).toEqual({
    state: "paused_name",
    name: "Ana Souza",
  });
  expect(pausedBy({ pausedBy: "usr_unnamed" }, "usr_me", members).state).toBe("paused_other");
  // Someone who left, and the server pausing after an account takeover.
  expect(pausedBy({ pausedBy: "usr_gone" }, "usr_me", members).state).toBe("paused_other");
  expect(pausedBy({ pausedBy: "sys_account" }, "usr_me", members).state).toBe("paused_other");
  const line = (locale: "en" | "pt-BR") =>
    m.monitor_last_result(
      { state: "paused_name", name: "Ana Souza", when: "5 min ago" },
      { locale },
    );
  expect(line("en")).toBe("Paused by Ana Souza 5 min ago");
  expect(line("pt-BR")).toBe("Pausado por Ana Souza 5 min ago");
});

test("the workspace's monitor cap: its owner's, within the instance's", () => {
  expect(workspaceMonitorCap(undefined, undefined)).toBe(100);
  expect(workspaceMonitorCap({ monitorCap: null }, 500)).toBe(500);
  expect(workspaceMonitorCap({ monitorCap: 20 }, 500)).toBe(20);
  // A cap set before the operator lowered the instance's counts as the instance's.
  expect(workspaceMonitorCap({ monitorCap: 300 }, 200)).toBe(200);
});

test("a region is stalled when every running monitor checked from it went quiet, not when one did", () => {
  const now = 10 * 60 * 60 * 1000;
  const fresh = (source: ProbeRegion, at: number): MonitorCheck => ({
    source,
    at,
    up: true,
    latencyMs: 10,
    colo: "IAD",
    httpStatus: 200,
    error: null,
  });
  const quiet = now - 60 * 60 * 1000;
  const a = row({ regions: ["enam", "weur"], checks: [fresh("enam", quiet), fresh("weur", now)] });
  const b = row({ regions: ["enam"], checks: [fresh("enam", quiet)] });
  expect(stalledRegions([a, b], now)).toEqual(["enam"]);
  // One monitor in the region still reports: that is the monitor, not the probe.
  const c = row({ regions: ["enam"], checks: [fresh("enam", now - 1000)] });
  expect(stalledRegions([a, b, c], now)).toEqual([]);
  // Paused monitors and heartbeats do not count; a new monitor waits its stale window first.
  expect(stalledRegions([{ ...b, paused: true }], now)).toEqual([]);
  expect(stalledRegions([row({ regions: ["weur"], restartedAt: now - 1000 })], now)).toEqual([]);
  expect(stalledRegions([row({ regions: ["weur"], restartedAt: quiet })], now)).toEqual(["weur"]);
  expect(m.monitor_stalled({ regions: "US East and Western Europe" }, { locale: "en" })).toBe(
    "Checks from US East and Western Europe stopped reporting. Monitors there show No data until they report again, and nobody is paged for it.",
  );
});
