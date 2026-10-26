import { describe, expect, test } from "vite-plus/test";
import type {
  DeliveryRow,
  DeviceSummaryRow,
  Escalation,
  EscalationPage,
  IncidentRow,
  MemberRow,
  ScheduleRow,
  TimelineEntry,
  TimelineRow,
} from "@freecorps/brigade-schema";
import { PAGE_STUCK_MS, whyPaged, type WhyInput } from "../src/paging.ts";

const T = Date.UTC(2026, 9, 26, 3, 0, 0);
const INC = "inc_01JBAAAAAAAAAAAAAAAAAAAAAA";
const RUN = "evt_01JBAAAAAAAAAAAAAAAAAAAAAA";
const DEV = "dev_01JBAAAAAAAAAAAAAAAAAAAAAA";
const SCHEDULE = "sch_01JBAAAAAAAAAAAAAAAAAAAAAA";

const member = (id: string, role: MemberRow["role"] = "responder"): MemberRow => ({
  id,
  name: id.slice(4),
  role,
  updatedAt: T,
});
const members = [
  member("usr_ana", "owner"),
  member("usr_bia"),
  member("usr_caio"),
  member("usr_vera", "viewer"),
];
const schedules = [{ id: SCHEDULE, name: "Primary" } as ScheduleRow];

function page(overrides: Partial<EscalationPage> = {}): EscalationPage {
  return {
    level: 1,
    round: 0,
    at: T,
    userIds: ["usr_bia"],
    missed: [],
    missedCount: 0,
    reason: "started",
    ...overrides,
  };
}

function run(pages: EscalationPage[], overrides: Partial<Escalation> = {}): Escalation {
  return {
    policyId: "esc_01JBAAAAAAAAAAAAAAAAAAAAAA",
    policyName: "Default",
    levels: [
      {
        id: "lvl_01JBAAAAAAAAAAAAAAAAAAAAAA",
        targets: [{ kind: "schedule", id: SCHEDULE }],
        timeoutMinutes: 5,
      },
      {
        id: "lvl_01JBBBBBBBBBBBBBBBBBBBBBBB",
        targets: [{ kind: "member", id: "usr_ana" }],
        timeoutMinutes: 5,
      },
    ],
    repeat: 0,
    eventId: RUN,
    causedBy: "sys_monitors",
    status: "running",
    startedAt: T,
    endedAt: null,
    nextAt: T + 300_000,
    paged: pages.length,
    pages,
    ...overrides,
  };
}

function incident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: INC,
    number: 7,
    title: "Checkout is down",
    severity: "sev1",
    status: "investigating",
    declaredAt: T,
    declaredBy: "sys_monitors",
    acknowledgedAt: null,
    acknowledgedBy: null,
    updatedAt: T,
    ...overrides,
  };
}

function delivery(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: `${INC}:${RUN}:${DEV}`,
    incidentId: INC,
    eventId: RUN,
    deviceId: DEV,
    userId: "usr_bia",
    platform: "ios",
    environment: "production",
    run: RUN,
    step: 1,
    plannedAt: T,
    sentAt: T + 200,
    acceptedAt: T + 400,
    deliveredAt: null,
    attempts: 1,
    error: null,
    reason: null,
    updatedAt: T,
    ...overrides,
  };
}

const device: DeviceSummaryRow = {
  id: DEV,
  userId: "usr_bia",
  platform: "ios",
  environment: "production",
  voip: false,
  registeredAt: T - 86_400_000,
  lastSeenAt: T - 3_600_000,
};

let seq = 0;
const entry = (fields: TimelineEntry): TimelineRow =>
  ({
    id: `${INC}:${++seq}`,
    incidentId: INC,
    seq,
    at: T + 1000,
    actor: "sys_notifier",
    ...fields,
  }) as TimelineRow;

function input(overrides: Partial<WhyInput> = {}): WhyInput {
  return {
    incident: incident({ escalation: run([page()]) }),
    userId: "usr_bia",
    members,
    devices: [device],
    deliveries: [],
    timeline: [],
    schedules,
    now: T + 1000,
    ...overrides,
  };
}

describe("whyPaged", () => {
  test("on call, and the phone said it opened the page", () => {
    const why = whyPaged(input({ deliveries: [delivery({ deliveredAt: T + 900 })] }));
    expect(why.verdict).toBe("delivered");
    expect(why.rule).toEqual({ kind: "policy", name: "Default" });
    expect(why.pages).toHaveLength(1);
    expect(why.pages[0]).toMatchObject({
      step: 1,
      level: 1,
      targeted: "paged",
      schedules: ["Primary"],
    });
    expect(why.pages[0]?.deliveries.map((one) => one.stage)).toEqual(["delivered"]);
    expect(why.devices).toEqual([device]);
    expect(why.email).toBeNull();
  });

  test("APNs took it but no receipt came: accepted, not delivered", () => {
    expect(whyPaged(input({ deliveries: [delivery()] })).verdict).toBe("accepted");
  });

  test("still on its way", () => {
    const planned = delivery({ sentAt: null, acceptedAt: null, attempts: 0 });
    expect(whyPaged(input({ deliveries: [planned] })).verdict).toBe("sending");
  });

  test("planned and never sent past the retry window: stuck, not sending forever", () => {
    const planned = delivery({ sentAt: null, acceptedAt: null, attempts: 0 });
    const at = (now: number) => whyPaged(input({ deliveries: [planned], now }));
    expect(at(T + PAGE_STUCK_MS - 1).verdict).toBe("sending");
    const stuck = at(T + PAGE_STUCK_MS);
    expect(stuck.verdict).toBe("stuck");
    expect(stuck.pages[0]?.deliveries).toMatchObject([{ stage: "planned", stuck: true }]);
    // Another phone still on its way is sending; one that took the page is accepted, whatever else is stuck.
    const fresh = delivery({
      id: `${INC}:${RUN}:dev_01JBCCCCCCCCCCCCCCCCCCCCCC`,
      deviceId: "dev_01JBCCCCCCCCCCCCCCCCCCCCCC",
      plannedAt: T + PAGE_STUCK_MS,
      sentAt: null,
      acceptedAt: null,
    });
    const both = (other: DeliveryRow) =>
      whyPaged(input({ deliveries: [planned, other], now: T + PAGE_STUCK_MS })).verdict;
    expect(both(fresh)).toBe("sending");
    expect(both({ ...fresh, sentAt: T + PAGE_STUCK_MS, acceptedAt: T + PAGE_STUCK_MS })).toBe(
      "accepted",
    );
    // A failed attempt was sent: failed, not stuck.
    const failed = delivery({ acceptedAt: null, error: "relay_unreachable" });
    expect(whyPaged(input({ deliveries: [failed], now: T + PAGE_STUCK_MS * 10 })).verdict).toBe(
      "failed",
    );
  });

  test("APNs refused the token: failed, with the error on the device's row", () => {
    const refused = delivery({
      acceptedAt: null,
      error: "token_invalid",
      reason: "BadDeviceToken",
    });
    const why = whyPaged(
      input({
        deliveries: [refused],
        timeline: [
          entry({
            kind: "page_failed",
            userId: "usr_bia",
            reason: "undelivered",
            run: RUN,
            step: 1,
          }),
        ],
      }),
    );
    expect(why.verdict).toBe("failed");
    expect(why.pages[0]?.deliveries[0]?.row).toMatchObject({
      error: "token_invalid",
      reason: "BadDeviceToken",
    });
    expect(why.pages[0]?.misses).toEqual([{ reason: "undelivered", at: T + 1000, schedule: null }]);
    // A SEV1 page that missed them: Brigade emails them about it.
    expect(why.email).toBe("expected");
  });

  test("on call with no device: missed, and the email says what happened to it", () => {
    const noDevice = page({
      userIds: [],
      missed: [
        { userId: "usr_bia", reason: "no_devices", scheduleId: SCHEDULE, schedule: "Primary" },
      ],
      missedCount: 1,
    });
    const failed = entry({
      kind: "page_failed",
      userId: "usr_bia",
      reason: "no_devices",
      run: RUN,
      step: 1,
    });
    const base = input({
      incident: incident({ escalation: run([noDevice]) }),
      devices: [],
      timeline: [failed],
    });
    const why = whyPaged(base);
    expect(why.verdict).toBe("missed");
    expect(why.devices).toEqual([]);
    expect(why.email).toBe("expected");
    expect(whyPaged({ ...base, email: { unpaged: false, nobodyPaged: true } }).email).toBe("off");
    const capped = entry({
      kind: "email_failed",
      userId: "usr_bia",
      reason: "capped",
      about: "unpaged",
    });
    expect(whyPaged({ ...base, timeline: [failed, capped] }).email).toBe("capped");
  });

  test("someone else was on call", () => {
    const why = whyPaged(
      input({ incident: incident({ escalation: run([page({ userIds: ["usr_caio"] })]) }) }),
    );
    expect(why.verdict).toBe("not_targeted");
    expect(why.pages[0]).toMatchObject({
      targeted: "not_on_call",
      reached: ["usr_caio"],
      schedules: ["Primary"],
    });
  });

  test("a level that names someone else", () => {
    const second = page({ level: 2, reason: "timeout", userIds: ["usr_ana"] });
    const why = whyPaged(
      input({
        incident: incident({ escalation: run([page({ userIds: ["usr_caio"] }), second]) }),
      }),
    );
    expect(why.pages.map((one) => one.targeted)).toEqual(["not_on_call", "not_in_level"]);
    expect(why.pages.map((one) => one.step)).toEqual([1, 2]);
  });

  test("whoever declared it is counted as reached, not pushed", () => {
    const declared = incident({
      declaredBy: "usr_bia",
      escalation: run([page({ userIds: ["usr_bia"] })], { causedBy: "usr_bia" }),
    });
    const why = whyPaged(input({ incident: declared }));
    expect(why.verdict).toBe("declarer");
    expect(why.pages[0]?.targeted).toBe("declarer");
  });

  test("a viewer cannot be paged; neither can someone no longer a member", () => {
    const everyone = incident({
      escalation: run([page({ level: null, userIds: [], reason: "exhausted" })]),
    });
    const viewer = whyPaged(input({ incident: everyone, userId: "usr_vera", devices: [] }));
    expect(viewer).toMatchObject({
      verdict: "excluded",
      member: { status: "viewer", role: "viewer" },
    });
    expect(viewer.pages[0]?.targeted).toBe("excluded");
    const gone = whyPaged(input({ userId: "usr_zoe" }));
    expect(gone).toMatchObject({ verdict: "excluded", member: { status: "gone", role: null } });
  });

  test("without a policy, the interim rule paged the commander alone", () => {
    const why = whyPaged(input({ incident: incident({ roles: { commander: "usr_caio" } }) }));
    expect(why.rule).toEqual({ kind: "interim", commander: "usr_caio" });
    expect(why.verdict).toBe("not_targeted");
    expect(why.pages).toEqual([
      expect.objectContaining({ step: null, targeted: "commander_only" }),
    ]);
  });

  test("without a policy, a page to everyone reached their phone", () => {
    const why = whyPaged(
      input({
        incident: incident(),
        deliveries: [delivery({ run: null, step: null, deliveredAt: T + 500 })],
      }),
    );
    expect(why.verdict).toBe("delivered");
    expect(why.pages[0]).toMatchObject({ step: null, targeted: "paged" });
  });

  test("says who acknowledged, and nothing paged at all is none", () => {
    const acked = incident({
      acknowledgedAt: T + 60_000,
      acknowledgedBy: "usr_ana",
      escalation: run([]),
    });
    const why = whyPaged(input({ incident: acked }));
    expect(why.acknowledged).toEqual({ by: "usr_ana", at: T + 60_000 });
    expect(why.verdict).toBe("none");
  });

  test("another member's deliveries are not theirs", () => {
    const why = whyPaged(input({ deliveries: [delivery({ userId: "usr_caio" })] }));
    expect(why.pages[0]?.deliveries).toEqual([]);
  });
});
