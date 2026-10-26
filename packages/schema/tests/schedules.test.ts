import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  layerShiftAt,
  localMinute,
  MEMBERS_ACTOR,
  mutations,
  nextHandoffs,
  onCallAt,
  runMutation,
  serverMutations,
  wallMinute,
  wallParts,
  zonedInstant,
  type BrigadeTables,
  type MutationContext,
  type OverrideRow,
  type Role,
  type ScheduleLayer,
  type ScheduleRow,
} from "../src/index.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 9, 26, 12, 0, 0);

const SCH = "sch_01JB0000000000000000000001";
const LYR1 = "lyr_01JB0000000000000000000001";
const LYR2 = "lyr_01JB0000000000000000000002";
const OVR1 = "ovr_01JB0000000000000000000001";
const OVR2 = "ovr_01JB0000000000000000000002";

const layer = (patch: Partial<ScheduleLayer> = {}): ScheduleLayer => ({
  id: LYR1,
  name: "Primary",
  members: ["usr_ana", "usr_bia", "usr_caio"],
  startDate: "2026-10-05",
  handoffTime: "09:00",
  unit: "weeks",
  count: 1,
  ...patch,
});

const schedule = (
  layers: ScheduleLayer[],
  timeZone = "America/Sao_Paulo",
): Pick<ScheduleRow, "id" | "timeZone" | "layers"> => ({ id: SCH, timeZone, layers });

const override = (patch: Partial<OverrideRow>): OverrideRow => ({
  id: OVR1,
  scheduleId: SCH,
  userId: "usr_duda",
  start: 0,
  end: 0,
  createdAt: 0,
  createdBy: "usr_ana",
  ...patch,
});

/** The instant the zone's wall clock shows `date` `time`. */
const at = (date: string, time: string, timeZone: string) =>
  zonedInstant(wallMinute(date, time)!, timeZone);
/** The zone's wall clock at `instant`, as `YYYY-MM-DD HH:MM`. */
const wall = (instant: number, timeZone: string) => {
  const parts = wallParts(localMinute(instant, timeZone));
  return `${parts.date} ${parts.time}`;
};

describe("zoned time", () => {
  test("round-trips ordinary wall-clock times", () => {
    for (const zone of [
      "America/Sao_Paulo",
      "America/New_York",
      "Europe/London",
      "Asia/Kolkata",
      "UTC",
    ]) {
      const instant = at("2026-03-15", "10:45", zone);
      expect(wall(instant, zone)).toBe("2026-03-15 10:45");
    }
    expect(at("2026-01-15", "09:00", "America/Sao_Paulo")).toBe(Date.UTC(2026, 0, 15, 12));
    expect(at("2026-01-15", "09:00", "Asia/Kolkata")).toBe(Date.UTC(2026, 0, 15, 3, 30));
  });

  test("a time skipped by clocks going forward moves forward by the gap", () => {
    // New York, 2026-03-08: 02:00 EST → 03:00 EDT.
    expect(wall(at("2026-03-08", "02:30", "America/New_York"), "America/New_York")).toBe(
      "2026-03-08 03:30",
    );
    // Sao Paulo, 2018-11-04 (historical DST): 00:00 → 01:00, so midnight did not happen.
    expect(at("2018-11-04", "00:00", "America/Sao_Paulo")).toBe(Date.UTC(2018, 10, 4, 3));
    expect(wall(at("2018-11-04", "00:00", "America/Sao_Paulo"), "America/Sao_Paulo")).toBe(
      "2018-11-04 01:00",
    );
  });

  test("a time that happens twice when clocks go back is the earlier one", () => {
    // London, 2026-10-25: 02:00 BST → 01:00 GMT; 01:30 is first at 00:30 UTC.
    expect(at("2026-10-25", "01:30", "Europe/London")).toBe(Date.UTC(2026, 9, 25, 0, 30));
    // Sao Paulo, 2019-02-17 00:00 (-02) → 2019-02-16 23:00 (-03): 23:30 on the 16th is first at 01:30 UTC.
    expect(at("2019-02-16", "23:30", "America/Sao_Paulo")).toBe(Date.UTC(2019, 1, 17, 1, 30));
  });

  test("rejects dates and times that do not exist", () => {
    expect(wallMinute("2026-02-29", "09:00")).toBeUndefined();
    expect(wallMinute("2026-02-28", "24:00")).toBeUndefined();
    expect(wallMinute("2026-2-28", "09:00")).toBeUndefined();
    expect(wallMinute("2028-02-29", "23:59")).toBeDefined();
  });
});

describe("onCallAt", () => {
  test("a weekly rotation hands off at its wall-clock time, in member order, wrapping around", () => {
    const s = schedule([layer()]);
    const zone = s.timeZone;
    expect(onCallAt(s, [], at("2026-10-05", "08:59", zone))).toBeNull();
    expect(onCallAt(s, [], at("2026-10-05", "09:00", zone))?.userId).toBe("usr_ana");
    expect(onCallAt(s, [], at("2026-10-12", "08:59", zone))?.userId).toBe("usr_ana");
    expect(onCallAt(s, [], at("2026-10-12", "09:00", zone))?.userId).toBe("usr_bia");
    expect(onCallAt(s, [], at("2026-10-19", "09:00", zone))?.userId).toBe("usr_caio");
    expect(onCallAt(s, [], at("2026-10-26", "09:00", zone))).toEqual({
      userId: "usr_ana",
      source: { kind: "layer", layerId: LYR1 },
    });
  });

  test("daily and custom-hour rotations", () => {
    const daily = schedule([layer({ unit: "days", count: 2, members: ["usr_ana", "usr_bia"] })]);
    expect(onCallAt(daily, [], at("2026-10-06", "12:00", daily.timeZone))?.userId).toBe("usr_ana");
    expect(onCallAt(daily, [], at("2026-10-07", "09:00", daily.timeZone))?.userId).toBe("usr_bia");
    const hours = schedule([layer({ unit: "hours", count: 12, members: ["usr_ana", "usr_bia"] })]);
    expect(onCallAt(hours, [], at("2026-10-05", "20:59", hours.timeZone))?.userId).toBe("usr_ana");
    expect(onCallAt(hours, [], at("2026-10-05", "21:00", hours.timeZone))?.userId).toBe("usr_bia");
    expect(onCallAt(hours, [], at("2026-10-06", "09:00", hours.timeZone))?.userId).toBe("usr_ana");
  });

  test("a later layer wins where it has someone; an earlier one shows through before it starts", () => {
    const s = schedule([
      layer(),
      layer({ id: LYR2, name: "Holiday", members: ["usr_duda"], startDate: "2026-10-20" }),
    ]);
    expect(onCallAt(s, [], at("2026-10-19", "12:00", s.timeZone))?.userId).toBe("usr_caio");
    expect(onCallAt(s, [], at("2026-10-20", "09:00", s.timeZone))).toEqual({
      userId: "usr_duda",
      source: { kind: "layer", layerId: LYR2 },
    });
    // An emptied later layer leaves the earlier one in charge.
    const emptied = schedule([layer(), layer({ id: LYR2, members: [] })]);
    expect(onCallAt(emptied, [], T)?.source).toEqual({ kind: "layer", layerId: LYR1 });
  });

  test("overrides win over every layer, the one added last over earlier ones, only inside [start, end)", () => {
    const s = schedule([layer()]);
    const start = at("2026-10-27", "18:00", s.timeZone);
    const end = start + 4 * HOUR;
    const one = override({ start, end });
    const two = override({
      id: OVR2,
      userId: "usr_bia",
      start: start + HOUR,
      end: start + 2 * HOUR,
    });
    const other = override({
      id: "ovr_01JB0000000000000000000009",
      scheduleId: "sch_other",
      start,
      end,
    });
    expect(onCallAt(s, [one, two, other], start - 1)?.userId).toBe("usr_ana");
    expect(onCallAt(s, [one, two, other], start)).toEqual({
      userId: "usr_duda",
      source: { kind: "override", overrideId: OVR1 },
    });
    expect(onCallAt(s, [two, one], start + HOUR)?.userId).toBe("usr_bia");
    expect(onCallAt(s, [one, two], start + 3 * HOUR)?.userId).toBe("usr_duda");
    expect(onCallAt(s, [one, two], end)?.userId).toBe("usr_ana");
    // An override covers a gap too.
    expect(onCallAt(schedule([]), [one], start)?.userId).toBe("usr_duda");
    expect(onCallAt(schedule([]), [], start)).toBeNull();
  });
});

describe("handoffs across DST", () => {
  test("New York: a daily 09:00 handoff stays at 09:00 local; the day clocks go forward lasts 23 hours", () => {
    const zone = "America/New_York";
    const s = schedule([layer({ unit: "days", count: 1, startDate: "2026-03-06" })], zone);
    const before = layerShiftAt(s.layers[0], zone, at("2026-03-07", "12:00", zone))!;
    expect(wall(before.start, zone)).toBe("2026-03-07 09:00");
    expect(wall(before.end, zone)).toBe("2026-03-08 09:00");
    expect(before.end - before.start).toBe(23 * HOUR);
    const after = layerShiftAt(s.layers[0], zone, before.end)!;
    expect(after.end - after.start).toBe(DAY);
    expect(onCallAt(s, [], before.end)?.userId).toBe("usr_caio");
  });

  test("London: the weekly shift over clocks going back lasts 169 hours", () => {
    const zone = "Europe/London";
    const s = schedule([layer({ startDate: "2026-10-19", handoffTime: "10:00" })], zone);
    const shift = layerShiftAt(s.layers[0], zone, at("2026-10-25", "12:00", zone))!;
    expect(wall(shift.start, zone)).toBe("2026-10-19 10:00");
    expect(wall(shift.end, zone)).toBe("2026-10-26 10:00");
    expect(shift.end - shift.start).toBe(7 * DAY + HOUR);
  });

  test("Sao Paulo (historical): a midnight handoff on a day midnight was skipped happens at 01:00", () => {
    const zone = "America/Sao_Paulo";
    const s = schedule(
      [layer({ unit: "days", count: 1, startDate: "2018-11-01", handoffTime: "00:00" })],
      zone,
    );
    const shift = layerShiftAt(s.layers[0], zone, at("2018-11-03", "12:00", zone))!;
    expect(wall(shift.end, zone)).toBe("2018-11-04 01:00");
    expect(shift.end - shift.start).toBe(DAY);
    const next = layerShiftAt(s.layers[0], zone, shift.end)!;
    expect(wall(next.start, zone)).toBe("2018-11-04 01:00");
    expect(wall(next.end, zone)).toBe("2018-11-05 00:00");
    expect(next.end - next.start).toBe(23 * HOUR);
    expect(onCallAt(s, [], shift.end - 1)?.userId).toBe("usr_caio");
    expect(onCallAt(s, [], shift.end)?.userId).toBe("usr_ana");
  });

  test("Sao Paulo (historical): the day clocks went back, a 23:30 handoff happens once, the first time", () => {
    const zone = "America/Sao_Paulo";
    const s = schedule(
      [layer({ unit: "days", count: 1, startDate: "2019-02-14", handoffTime: "23:30" })],
      zone,
    );
    const shift = layerShiftAt(s.layers[0], zone, Date.UTC(2019, 1, 17, 2, 0))!;
    expect(shift.start).toBe(Date.UTC(2019, 1, 17, 1, 30));
    expect(shift.end - shift.start).toBe(25 * HOUR);
  });

  test("hourly shifts: the shift starting in a skipped hour is empty, and the next member takes over", () => {
    const zone = "America/New_York";
    const s = schedule(
      [layer({ unit: "hours", count: 1, startDate: "2026-03-08", handoffTime: "00:00" })],
      zone,
    );
    // 00:00 ana, 01:00 bia, 02:00 caio (never happens), 03:00 ana.
    expect(onCallAt(s, [], at("2026-03-08", "01:59", zone))?.userId).toBe("usr_bia");
    expect(onCallAt(s, [], at("2026-03-08", "03:00", zone))?.userId).toBe("usr_ana");
    const segments = nextHandoffs(
      s,
      [],
      at("2026-03-08", "00:30", zone),
      at("2026-03-08", "05:00", zone),
    );
    expect(segments.map((segment) => [wall(segment.start, zone), segment.userId])).toEqual([
      ["2026-03-08 00:30", "usr_ana"],
      ["2026-03-08 01:00", "usr_bia"],
      ["2026-03-08 03:00", "usr_ana"],
      ["2026-03-08 04:00", "usr_bia"],
    ]);
  });
});

describe("nextHandoffs", () => {
  test("lists who is on call from now and each handoff, with overrides cutting in", () => {
    const s = schedule([layer()]);
    const zone = s.timeZone;
    const from = at("2026-10-14", "12:00", zone);
    const cover = override({
      start: at("2026-10-15", "18:00", zone),
      end: at("2026-10-16", "08:00", zone),
    });
    const segments = nextHandoffs(s, [cover], from, from + 21 * DAY, 4);
    expect(
      segments.map((segment) => [
        wall(segment.start, zone),
        wall(segment.end, zone),
        segment.userId,
      ]),
    ).toEqual([
      ["2026-10-14 12:00", "2026-10-15 18:00", "usr_bia"],
      ["2026-10-15 18:00", "2026-10-16 08:00", "usr_duda"],
      ["2026-10-16 08:00", "2026-10-19 09:00", "usr_bia"],
      ["2026-10-19 09:00", "2026-10-26 09:00", "usr_caio"],
    ]);
    expect(segments[1].source).toEqual({ kind: "override", overrideId: OVR1 });
  });

  test("a one-member layer has no handoffs, and a gap is a segment of nobody", () => {
    const s = schedule([layer({ members: ["usr_ana"], startDate: "2026-10-20" })]);
    const segments = nextHandoffs(s, [], T - 10 * DAY, T + 30 * DAY);
    expect(segments.map((segment) => segment.userId)).toEqual([null, "usr_ana"]);
    expect(segments[1].end).toBe(T + 30 * DAY);
    expect(nextHandoffs(s, [], T, T)).toEqual([]);
  });
});

// ---- Mutations ----------------------------------------------------------------------------------------------------

const ctx = (id: string, role: Role, kind: "user" | "system" = "user"): MutationContext => ({
  actor: { kind, id, role },
  now: T,
  server: true,
});

function shard() {
  const store = createMemoryStore<BrigadeTables>();
  for (const [id, role] of [
    ["usr_ana", "owner"],
    ["usr_bia", "admin"],
    ["usr_caio", "responder"],
    ["usr_duda", "viewer"],
    ["usr_eva", "responder"],
  ] as const) {
    store.insert("members", { id, name: id.slice(4), role, updatedAt: 0 });
  }
  return store;
}

const createArgs = (patch: Record<string, unknown> = {}) => ({
  id: SCH,
  name: "Platform",
  timeZone: "America/Sao_Paulo",
  layers: [layer({ members: ["usr_ana", "usr_caio", "usr_eva"] })],
  ...patch,
});

describe("schedule mutations", () => {
  test("owners and admins create, edit and delete schedules; responders and viewers cannot", () => {
    for (const role of ["responder", "viewer"] as const) {
      const result = runMutation(
        mutations,
        "schedule.create",
        createArgs(),
        shard(),
        ctx("usr_x", role),
      );
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    const store = shard();
    const created = runMutation(
      mutations,
      "schedule.create",
      createArgs(),
      store,
      ctx("usr_bia", "admin"),
    );
    expect(created).toEqual({
      ok: true,
      events: [
        {
          type: "schedule.created",
          subject: SCH,
          data: { id: SCH, name: "Platform", timeZone: "America/Sao_Paulo", layers: 1 },
        },
      ],
    });
    expect(store.get("schedules", SCH)).toMatchObject({ createdBy: "usr_bia", createdAt: T });
    const renamed = createArgs({ name: "Platform on call", timeZone: "Europe/London" });
    const updated = runMutation(
      mutations,
      "schedule.update",
      renamed,
      store,
      ctx("usr_ana", "owner"),
    );
    expect(updated).toMatchObject({
      ok: true,
      events: [{ type: "schedule.updated", data: { reason: "edited" } }],
    });
    expect(
      runMutation(mutations, "schedule.update", renamed, store, ctx("usr_ana", "owner")),
    ).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(
      runMutation(mutations, "schedule.update", renamed, store, ctx("usr_caio", "responder")),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const deleted = runMutation(
      mutations,
      "schedule.delete",
      { id: SCH },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(deleted).toMatchObject({ ok: true, events: [{ type: "schedule.deleted" }] });
    expect(store.scan("schedules")).toEqual([]);
  });

  test("validates the time zone, dates, shift lengths and rotation members", () => {
    const run = (patch: Record<string, unknown>) =>
      runMutation(
        mutations,
        "schedule.create",
        createArgs(patch),
        shard(),
        ctx("usr_ana", "owner"),
      );
    const paths = (result: ReturnType<typeof run>) =>
      result.ok ? [] : (result.error.issues ?? []).map((issue) => issue.path);
    expect(paths(run({ timeZone: "Mars/Olympus" }))).toEqual(["timeZone"]);
    expect(paths(run({ timeZone: "America/Sao Paulo" }))).toEqual(["timeZone"]);
    expect(paths(run({ layers: [layer({ startDate: "2026-02-30" })] }))).toEqual([
      "layers[0].startDate",
    ]);
    expect(paths(run({ layers: [layer({ handoffTime: "9:00" })] }))).toEqual([
      "layers[0].handoffTime",
    ]);
    expect(paths(run({ layers: [layer({ unit: "days", count: 32 })] }))).toEqual([
      "layers[0].count",
    ]);
    expect(paths(run({ layers: [layer({ members: [] })] }))).toEqual(["layers[0].members"]);
    expect(paths(run({ layers: [layer({ members: ["usr_ana", "usr_ana"] })] }))).toEqual([
      "layers[0].members[1]",
    ]);
    expect(
      paths(run({ layers: [layer({ members: ["usr_ana", "usr_duda", "usr_zoe"] })] })),
    ).toEqual(["layers[0].members[1]", "layers[0].members[2]"]);
    expect(paths(run({ layers: [layer(), layer()] }))).toEqual(["layers[1].id"]);
    expect(paths(run({ layers: [] }))).toEqual(["layers"]);
  });

  test("caps schedules per workspace", () => {
    const store = shard();
    for (let i = 0; i < 50; i++) {
      const id = `sch_01JB00000000000000000001${String(i).padStart(2, "0")}`;
      expect(
        runMutation(
          mutations,
          "schedule.create",
          createArgs({ id }),
          store,
          ctx("usr_ana", "owner"),
        ).ok,
      ).toBe(true);
    }
    expect(
      runMutation(mutations, "schedule.create", createArgs(), store, ctx("usr_ana", "owner")),
    ).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
  });
});

describe("overrides", () => {
  const cover = (patch: Record<string, unknown> = {}) => ({
    id: OVR1,
    scheduleId: SCH,
    userId: "usr_caio",
    start: T + HOUR,
    end: T + 5 * HOUR,
    ...patch,
  });
  const withSchedule = () => {
    const store = shard();
    runMutation(mutations, "schedule.create", createArgs(), store, ctx("usr_ana", "owner"));
    return store;
  };

  test("responders add and remove overrides only for themselves; admins for anyone; viewers never", () => {
    const store = withSchedule();
    expect(
      runMutation(
        mutations,
        "schedule.addOverride",
        cover({ userId: "usr_eva" }),
        store,
        ctx("usr_caio", "responder"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      runMutation(
        mutations,
        "schedule.addOverride",
        cover({ userId: "usr_duda" }),
        store,
        ctx("usr_duda", "viewer"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const own = runMutation(
      mutations,
      "schedule.addOverride",
      cover(),
      store,
      ctx("usr_caio", "responder"),
    );
    expect(own).toMatchObject({
      ok: true,
      events: [{ type: "schedule.override_added", data: { userId: "usr_caio", start: T + HOUR } }],
    });
    const forEva = cover({ id: OVR2, userId: "usr_eva" });
    expect(
      runMutation(mutations, "schedule.addOverride", forEva, store, ctx("usr_bia", "admin")).ok,
    ).toBe(true);
    expect(
      runMutation(
        mutations,
        "schedule.removeOverride",
        { id: OVR2 },
        store,
        ctx("usr_caio", "responder"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      runMutation(
        mutations,
        "schedule.removeOverride",
        { id: OVR1 },
        store,
        ctx("usr_caio", "responder"),
      ),
    ).toMatchObject({
      ok: true,
      events: [{ type: "schedule.override_removed", data: { reason: "removed" } }],
    });
    expect(
      runMutation(
        mutations,
        "schedule.removeOverride",
        { id: OVR2 },
        store,
        ctx("usr_ana", "owner"),
      ).ok,
    ).toBe(true);
  });

  test("refuses empty, backwards, past, too long, off-minute overrides, and viewers covering", () => {
    const store = withSchedule();
    const run = (patch: Record<string, unknown>) =>
      runMutation(mutations, "schedule.addOverride", cover(patch), store, ctx("usr_ana", "owner"));
    expect(run({ end: T + HOUR })).toMatchObject({ error: { code: "invalid_args" } });
    expect(run({ start: T - 5 * HOUR, end: T - HOUR })).toMatchObject({
      error: { code: "invalid_args" },
    });
    expect(run({ end: T + HOUR + 91 * DAY })).toMatchObject({ error: { code: "invalid_args" } });
    expect(run({ start: T + HOUR + 1 })).toMatchObject({ error: { code: "invalid_args" } });
    expect(run({ userId: "usr_duda" })).toMatchObject({ error: { code: "invalid_args" } });
    expect(run({ scheduleId: "sch_01JB0000000000000000000099" })).toMatchObject({
      error: { code: "not_found" },
    });
  });

  test("an override that ended a month ago is deleted when the next one is added", () => {
    const store = withSchedule();
    store.insert("overrides", override({ id: OVR2, start: T - 40 * DAY, end: T - 31 * DAY }));
    const result = runMutation(
      mutations,
      "schedule.addOverride",
      cover(),
      store,
      ctx("usr_ana", "owner"),
    );
    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: "schedule.override_added" },
        { type: "schedule.override_removed", data: { reason: "expired" } },
      ],
    });
    expect(store.scan("overrides").map((row) => row.id)).toEqual([OVR1]);
  });

  test("deleting a schedule deletes its overrides", () => {
    const store = withSchedule();
    runMutation(mutations, "schedule.addOverride", cover(), store, ctx("usr_ana", "owner"));
    const result = runMutation(
      mutations,
      "schedule.delete",
      { id: SCH },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(result).toMatchObject({ ok: true, events: [{ data: { overrides: 1 } }] });
    expect(store.scan("overrides")).toEqual([]);
  });
});

describe("members leaving the rotations", () => {
  const prepared = () => {
    const store = shard();
    runMutation(
      mutations,
      "schedule.create",
      createArgs({
        layers: [
          layer({ members: ["usr_ana", "usr_caio", "usr_eva"] }),
          layer({ id: LYR2, name: "Nights", members: ["usr_caio"], startDate: "2026-10-26" }),
        ],
      }),
      store,
      ctx("usr_ana", "owner"),
    );
    store.insert("overrides", override({ userId: "usr_caio", start: T + HOUR, end: T + 2 * HOUR }));
    store.insert(
      "overrides",
      override({ id: OVR2, userId: "usr_eva", start: T + HOUR, end: T + 2 * HOUR }),
    );
    return store;
  };

  test("member.remove takes them out of every layer and deletes their overrides, in the same transaction", () => {
    const store = prepared();
    const result = runMutation(
      serverMutations,
      "member.remove",
      { id: "usr_caio", role: "responder", reason: "removed" },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: "member.removed" },
        {
          type: "schedule.updated",
          subject: SCH,
          data: { reason: "member_removed", userId: "usr_caio" },
        },
        { type: "schedule.override_removed", subject: OVR1, data: { reason: "member_removed" } },
      ],
    });
    const row = store.get("schedules", SCH)!;
    expect(row.layers.map((l) => l.members)).toEqual([["usr_ana", "usr_eva"], []]);
    expect(store.scan("overrides").map((o) => o.id)).toEqual([OVR2]);
    // The emptied layer is a gap the first one shows through; the rest of the rotation moves up.
    expect(
      onCallAt(row, store.scan("overrides"), at("2026-10-12", "09:00", row.timeZone))?.userId,
    ).toBe("usr_eva");
    expect(onCallAt(row, [], T)).toEqual({
      userId: "usr_eva",
      source: { kind: "layer", layerId: LYR1 },
    });
  });

  test("leaving and a reconcile do the same, and a removed member's only layer becomes a visible gap", () => {
    const store = shard();
    runMutation(
      mutations,
      "schedule.create",
      createArgs({ layers: [layer({ members: ["usr_eva"] })] }),
      store,
      ctx("usr_ana", "owner"),
    );
    const left = runMutation(
      serverMutations,
      "member.remove",
      { id: "usr_eva", role: "responder", reason: "left" },
      store,
      ctx("usr_eva", "responder"),
    );
    expect(left).toMatchObject({
      ok: true,
      events: [{ type: "member.removed" }, { type: "schedule.updated" }],
    });
    const row = store.get("schedules", SCH)!;
    expect(onCallAt(row, [], T)).toBeNull();
    expect(nextHandoffs(row, [], T, T + DAY)).toEqual([
      { start: T, end: T + DAY, userId: null, source: null },
    ]);

    const again = prepared();
    const reconciled = runMutation(
      serverMutations,
      "member.reconcile",
      {
        members: [
          { id: "usr_ana", role: "owner" },
          { id: "usr_bia", role: "admin" },
          { id: "usr_eva", role: "responder" },
        ],
      },
      again,
      ctx(MEMBERS_ACTOR.id, "admin", "system"),
    );
    expect(reconciled.ok).toBe(true);
    expect(again.get("schedules", SCH)!.layers[0].members).toEqual(["usr_ana", "usr_eva"]);
  });

  test("a member made a viewer leaves the rotations; another role change keeps them", () => {
    const store = prepared();
    const kept = runMutation(
      serverMutations,
      "member.changeRole",
      { id: "usr_eva", from: "responder", to: "admin" },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(kept).toMatchObject({ ok: true, events: [{ type: "member.role_changed" }] });
    expect(kept.ok && kept.events).toHaveLength(1);
    const viewer = runMutation(
      serverMutations,
      "member.changeRole",
      { id: "usr_eva", from: "admin", to: "viewer" },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(viewer).toMatchObject({
      ok: true,
      events: [
        { type: "member.role_changed" },
        { type: "schedule.updated", data: { userId: "usr_eva" } },
        { type: "schedule.override_removed", subject: OVR2 },
      ],
    });
    expect(store.get("schedules", SCH)!.layers[0].members).toEqual(["usr_ana", "usr_caio"]);
  });
});
