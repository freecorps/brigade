import { canonicalTimeZone, type MemberRow, type ScheduleLayer } from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import {
  checkOverride,
  checkSchedule,
  draftFromSchedule,
  draftMembers,
  emptyOverride,
  fromLocalInput,
  hiddenLayers,
  layerName,
  layerNow,
  layerRhythm,
  localInput,
  matchZone,
  rotationChoices,
  rotationFrom,
  withTimeZone,
  zoneGroups,
  zoneLabel,
  type ScheduleDraft,
} from "@/lib/oncall";

const SCH = "sch_01JB0000000000000000000001";
const layer: ScheduleLayer = {
  id: "lyr_01JB0000000000000000000001",
  name: "Primary",
  members: ["usr_ana", "usr_bia"],
  startDate: "2026-10-05",
  handoffTime: "09:00",
  unit: "weeks",
  count: 1,
};
const draft = (patch: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  name: " Platform ",
  timeZone: "America/Sao_Paulo",
  layers: [{ ...layer, count: "1" }],
  ...patch,
});

test("a schedule draft becomes the mutation's arguments, trimmed and with a numeric count", () => {
  expect(checkSchedule(SCH, draft())).toEqual({
    ok: true,
    args: { id: SCH, name: "Platform", timeZone: "America/Sao_Paulo", layers: [layer] },
  });
  const row = { id: SCH, name: "Platform", timeZone: "America/Sao_Paulo", layers: [layer] };
  expect(draftFromSchedule({ ...row, createdAt: 0, createdBy: "", updatedAt: 0 })).toEqual(
    draft({ name: "Platform" }),
  );
});

test("a schedule draft reports every wrong field, per layer", () => {
  const checked = checkSchedule(
    SCH,
    draft({
      name: "  ",
      timeZone: "Nowhere/Land",
      layers: [
        {
          ...layer,
          members: [],
          startDate: "2026-02-30",
          handoffTime: "25:00",
          unit: "days",
          count: "32",
        },
      ],
    }),
  );
  expect(checked).toEqual({
    ok: false,
    errors: {
      name: true,
      timeZone: true,
      layers: [{ members: "empty", startDate: true, handoffTime: true, count: true }],
    },
  });
});

test("override times are read on the schedule's wall clock, not the browser's", () => {
  const start = fromLocalInput("2026-10-27T18:00", "America/Sao_Paulo");
  expect(start).toBe(Date.UTC(2026, 9, 27, 21));
  expect(localInput(start!, "Europe/London")).toBe("2026-10-27T21:00");
  const now = Date.UTC(2026, 9, 26);
  expect(
    checkOverride(
      SCH,
      "America/Sao_Paulo",
      { userId: "usr_ana", start: "2026-10-27T18:00", end: "2026-10-28T06:00" },
      now,
    ),
  ).toEqual({
    ok: true,
    args: { scheduleId: SCH, userId: "usr_ana", start, end: start! + 12 * 60 * 60 * 1000 },
  });
  expect(
    checkOverride(
      SCH,
      "UTC",
      { userId: "", start: "2026-10-27T18:00", end: "2026-10-27T17:00" },
      now,
    ),
  ).toEqual({ ok: false, errors: { userId: true, end: true } });
});

test("a new override starts at the next whole hour on the schedule's clock, even a quarter-hour zone's", () => {
  // 09:20 in Kathmandu (+05:45) is 03:35 UTC: the next whole hour there is 10:00, not 04:00 UTC (09:45 there).
  const now = Date.UTC(2026, 9, 27, 3, 35);
  expect(emptyOverride("usr_ana", "Asia/Kathmandu", now)).toEqual({
    userId: "usr_ana",
    start: "2026-10-27T10:00",
    end: "2026-10-27T22:00",
  });
  expect(emptyOverride("", "America/Sao_Paulo", Date.UTC(2026, 9, 27, 12)).start).toBe(
    "2026-10-27T10:00",
  );
});

test("opening the editor drops viewers and people who left from its layers, and says so", () => {
  const members: MemberRow[] = [
    { id: "usr_ana", name: "Ana", role: "admin", updatedAt: 0 },
    { id: "usr_bia", name: "Bia", role: "viewer", updatedAt: 0 },
    { id: "usr_caio", name: "Caio", role: "responder", updatedAt: 0 },
  ];
  const opened = draftMembers(
    draft({
      layers: [
        { ...layer, members: ["usr_ana", "usr_bia", "usr_gone", "usr_caio"], count: "1" },
        { ...layer, id: "lyr_2", members: ["usr_bia"], count: "1" },
      ],
    }),
    members,
  );
  expect(opened.dropped).toBe(true);
  expect(opened.draft.layers.map((l) => l.members)).toEqual([["usr_ana", "usr_caio"], []]);
  // A layer left empty asks for someone, as any empty layer does.
  const checked = checkSchedule(SCH, opened.draft);
  expect(checked.ok ? null : checked.errors.layers).toEqual([{}, { members: "empty" }]);
  // Nobody to drop, or no list yet: the draft as it was.
  const kept = draft({ layers: [{ ...layer, members: ["usr_ana", "usr_caio"], count: "1" }] });
  expect(draftMembers(kept, members)).toEqual({ draft: kept, dropped: false });
  expect(draftMembers(kept, [])).toEqual({ draft: kept, dropped: false });
});

test("layers read as their rhythm, and viewers are never offered for a rotation", () => {
  expect(layerRhythm(layer, "en")).toBe("Weekly, hands off Monday at 9:00 AM");
  // Hourly shifts that fit a day a few times list each time; others say when they start.
  expect(layerRhythm({ ...layer, unit: "hours", count: 12 }, "pt-BR")).toBe(
    "A cada 12 horas, troca às 09:00 e 21:00",
  );
  expect(layerRhythm({ ...layer, handoffTime: "20:00", unit: "hours", count: 8 }, "en")).toBe(
    "Every 8 hours, hands off at 4:00 AM, 12:00 PM, and 8:00 PM",
  );
  expect(layerRhythm({ ...layer, unit: "hours", count: 5 }, "en")).toBe(
    "Every 5 hours, starting Oct 5 at 9:00 AM",
  );
  expect(layerRhythm({ ...layer, unit: "hours", count: 48 }, "en")).toBe(
    "Every 48 hours, hands off at 9:00 AM",
  );
  const members: MemberRow[] = [
    { id: "usr_c", name: null, role: "responder", updatedAt: 0 },
    { id: "usr_b", name: "Bia", role: "viewer", updatedAt: 0 },
    { id: "usr_a", name: "Ana", role: "admin", updatedAt: 0 },
  ];
  expect(rotationChoices(members).map((member) => member.id)).toEqual(["usr_a", "usr_c"]);
});

test("a schedule's zone is stored as the runtime spells it; a layer may be unnamed; 51 people is too many", () => {
  const people = Array.from({ length: 51 }, (_, i) => `usr_${i}`);
  const checked = checkSchedule(
    SCH,
    draft({ timeZone: "america/sao_paulo", layers: [{ ...layer, name: " ", count: "1" }] }),
  );
  expect(checked.ok && checked.args.timeZone).toBe("America/Sao_Paulo");
  expect(checked.ok && checked.args.layers[0]?.name).toBe("");
  expect(layerName({ name: "" }, 0)).toBe("Primary");
  expect(layerName({ name: "" }, 2)).toBe("Layer 3");
  expect(
    checkSchedule(SCH, draft({ layers: [{ ...layer, members: people, count: "1" }] })),
  ).toMatchObject({ ok: false, errors: { layers: [{ members: "too_many" }] } });
});

test("a new schedule's layers start today in the zone picked, unless someone chose a date", () => {
  // 2026-10-26 20:00 UTC: still the 26th in Sao Paulo, already the 27th in Tokyo.
  const now = Date.UTC(2026, 9, 26, 20);
  const start = draft({
    timeZone: "America/Sao_Paulo",
    layers: [
      { ...layer, startDate: "2026-10-26", count: "1" },
      { ...layer, id: "lyr_2", startDate: "2026-11-02", count: "1" },
    ],
  });
  expect(withTimeZone(start, "Asia/Tokyo", now).layers.map((l) => l.startDate)).toEqual([
    "2026-10-27",
    "2026-11-02",
  ]);
});

test("the time zone picker matches a city anywhere, or an offset, and lists the viewer's and used zones first", () => {
  const at = Date.UTC(2026, 9, 27, 12);
  // "Asia/Katmandu" in V8, "Asia/Kathmandu" elsewhere: the runtime's own spelling, listed once.
  const kathmandu = canonicalTimeZone("Asia/Kathmandu");
  const [suggested, all] = zoneGroups(at, "America/Sao_Paulo", [
    "Asia/Kathmandu",
    "UTC",
    "america/sao_paulo",
    "Mars/Olympus",
  ]);
  expect(suggested?.items.map((zone) => zone.value)).toEqual([
    "America/Sao_Paulo",
    kathmandu,
    "UTC",
  ]);
  expect(all?.items.some((zone) => zone.value === "America/Sao_Paulo")).toBe(false);
  const zones = [...(suggested?.items ?? []), ...(all?.items ?? [])];
  const find = (query: string) =>
    zones.filter((zone) => matchZone(zone, query)).map((zone) => zone.value);
  expect(find("paulo")).toEqual(["America/Sao_Paulo"]);
  expect(find("São Paulo")).toEqual(["America/Sao_Paulo"]);
  expect(find("+05:45")).toEqual([kathmandu]);
  expect(find("utc+5:45")).toEqual([kathmandu]);
  expect(find("new york")).toContain("America/New_York");
  expect(find("-03")).toContain("America/Sao_Paulo");
});

test("zones the runtime lists under an older name are found and shown by their current one", () => {
  const at = Date.UTC(2026, 9, 27, 12);
  const [suggested, all] = zoneGroups(at, "UTC", []);
  const zones = [...(suggested?.items ?? []), ...(all?.items ?? [])];
  const find = (query: string) =>
    zones.filter((zone) => matchZone(zone, query)).map((zone) => zone.label);
  // The real list (V8 here, as in Chrome and Workers): each city by its current name, under either spelling.
  for (const [query, label] of [
    ["kolkata", "Asia/Kolkata"],
    ["calcutta", "Asia/Kolkata"],
    ["kathmandu", "Asia/Kathmandu"],
    ["kyiv", "Europe/Kyiv"],
    ["ho chi minh", "Asia/Ho Chi Minh"],
    ["yangon", "Asia/Yangon"],
    ["rangoon", "Asia/Yangon"],
    ["nuuk", "America/Nuuk"],
    ["chuuk", "Pacific/Chuuk"],
    ["pohnpei", "Pacific/Pohnpei"],
    ["kanton", "Pacific/Kanton"],
  ] as const) {
    expect(find(query), query).toEqual([label]);
  }
  // Stored as the runtime spells it, whichever name was picked or saved elsewhere.
  const kolkata = zones.find((zone) => zone.label === "Asia/Kolkata");
  expect(kolkata?.value).toBe(canonicalTimeZone("Asia/Kolkata"));
  expect(zoneLabel("Asia/Calcutta")).toBe("Asia/Kolkata");
  expect(zoneLabel("Asia/Kolkata")).toBe("Asia/Kolkata");
  // Listed by the name shown, each zone once.
  const labels = (all?.items ?? []).map((zone) => zone.label);
  expect(labels).toEqual([...labels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  expect(new Set(zones.map((zone) => zone.value)).size).toBe(zones.length);
  // No label is a name IANA has replaced (every older spelling the runtime lists has a current one here).
  expect(
    labels.filter((label) =>
      /Calcutta|Katmandu|Kiev|Saigon|Rangoon|Godthab|Truk|Ponape/.test(label),
    ),
  ).toEqual([]);
});

test("a layer says who it has now, and whether a later layer or an override hides them", () => {
  const now = Date.UTC(2026, 9, 14, 15);
  const first = { ...layer, members: ["usr_ana", "usr_bia", "usr_caio"] };
  const second = { ...layer, id: "lyr_2", members: ["usr_duda"], startDate: "2026-10-12" };
  const zone = "America/Sao_Paulo";
  const segment = (
    source: { kind: "layer"; layerId: string } | { kind: "override"; overrideId: string },
  ) => ({
    start: now,
    end: now,
    userId: "x",
    source,
  });
  expect(layerNow(first, zone, now, segment({ kind: "layer", layerId: first.id }))).toEqual({
    state: "active",
    userId: "usr_bia",
    shift: 1,
  });
  expect(layerNow(first, zone, now, segment({ kind: "layer", layerId: second.id })).state).toBe(
    "hidden",
  );
  expect(layerNow(first, zone, now, segment({ kind: "override", overrideId: "ovr_1" })).state).toBe(
    "overridden",
  );
  expect(layerNow({ ...first, startDate: "2026-11-02" }, zone, now, undefined)).toEqual({
    state: "starts",
    at: Date.UTC(2026, 10, 2, 12),
  });
  expect(layerNow({ ...first, members: [] }, zone, now, undefined)).toEqual({ state: "empty" });
  // A later layer with people starting no later hides an earlier one for good; one starting later does not.
  expect(hiddenLayers([first, second])).toEqual([false, false]);
  expect(hiddenLayers([first, { ...second, startDate: "2026-10-05" }])).toEqual([true, false]);
  expect(hiddenLayers([first, { ...second, startDate: "2026-10-05", members: [] }])).toEqual([
    false,
    false,
  ]);
  expect(rotationFrom(["a", "b", "c", "d"], 6)).toEqual(["c", "d", "a", "b"]);
});
