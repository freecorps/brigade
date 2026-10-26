import { m } from "@freecorps/brigade-i18n";
import {
  newId,
  parseHeartbeatToken,
  REPORT_EVERY_MS,
  type MonitorCheck,
  type MonitorRow,
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
  monitorActions,
  monitorBadge,
  monitorRefusal,
  newHeartbeat,
  sourceChips,
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
        reason: checkErrorReason({ error }, expected),
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
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 10,
      regions: ["enam", "weur"],
    },
  });
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
    args: { id: heartbeat.id, name: "Checkout", intervalSeconds: 60, graceSeconds: 120 },
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

test("a refused monitor change uses the shared wording, except a monitor that is gone", () => {
  expect(monitorRefusal("forbidden")).toBe(m.sync_error_forbidden());
  expect(monitorRefusal("conflict")).toBe(m.sync_error_conflict());
  expect(monitorRefusal("not_found")).toBe("It was deleted.");
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
