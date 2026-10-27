import { setLocale } from "@freecorps/brigade-i18n";
import { people } from "@freecorps/brigade-i18n/incident";
import type { DeliveryRow, IncidentRow, MemberRow, TimelineRow } from "@freecorps/brigade-schema";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { canPageAgain, memberChoices, pagingList, type PagingData } from "./why";

afterEach(() => setLocale("en"));

const T = Date.UTC(2026, 9, 26, 3, 0, 0);
const INC = "inc_01JBAAAAAAAAAAAAAAAAAAAAAA";

const member = (id: string, name: string | null, role: MemberRow["role"] = "responder") =>
  ({ id, name, role, updatedAt: T }) satisfies MemberRow;

const incident = (fields: Partial<IncidentRow> = {}): IncidentRow => ({
  id: INC,
  number: 7,
  title: "Checkout is down",
  severity: "sev2",
  status: "investigating",
  declaredAt: T,
  declaredBy: "usr_ana",
  acknowledgedAt: null,
  acknowledgedBy: null,
  updatedAt: T,
  ...fields,
});

const delivery = (userId: string, fields: Partial<DeliveryRow> = {}): DeliveryRow => ({
  id: `${INC}:evt_1:dev_${userId}`,
  incidentId: INC,
  eventId: "evt_1",
  deviceId: `dev_${userId}`,
  userId,
  platform: "ios",
  environment: "production",
  run: null,
  step: null,
  plannedAt: T,
  sentAt: T + 200,
  acceptedAt: T + 400,
  deliveredAt: T + 600,
  attempts: 1,
  error: null,
  reason: null,
  updatedAt: T,
  ...fields,
});

const data = (fields: Partial<PagingData> = {}): PagingData => ({
  incident: incident(),
  members: [
    member("usr_ana", "Ana", "owner"),
    member("usr_bia", "Bia"),
    member("usr_caio", "Caio"),
    member("usr_vera", "Vera", "viewer"),
  ],
  devices: [],
  deliveries: [],
  timeline: [],
  schedules: [],
  now: T + 60_000,
  ...fields,
});

describe("pagingList", () => {
  test("lists whoever needs a look first, then the rest in member order", () => {
    const missed = {
      id: `${INC}:2`,
      incidentId: INC,
      seq: 2,
      at: T,
      actor: "sys_notifier",
      kind: "page_failed",
      userId: "usr_caio",
      reason: "no_devices",
    } as TimelineRow;
    const rows = pagingList(
      data({
        deliveries: [
          delivery("usr_bia", { acceptedAt: null, deliveredAt: null, error: "apns_refused" }),
        ],
        timeline: [missed],
      }),
    );
    expect(rows.map((row) => [row.id, row.verdict])).toEqual([
      ["usr_bia", "failed"],
      ["usr_caio", "missed"],
      ["usr_ana", "declarer"],
    ]);
  });

  test("keeps a viewer a page reached, and says what the call did", () => {
    const rows = pagingList(
      data({
        deliveries: [
          delivery("usr_vera"),
          delivery("usr_vera", {
            id: `${INC}:evt_1:dev_vera:call`,
            kind: "call",
            acceptedAt: null,
            deliveredAt: null,
            error: "apns_refused",
          }),
        ],
      }),
    );
    expect(rows[0]).toEqual({ id: "usr_vera", verdict: "delivered", call: "failed" });
  });

  test("is empty without anyone who can respond", () => {
    expect(pagingList(data({ members: [member("usr_vera", "Vera", "viewer")] }))).toEqual([]);
  });
});

describe("memberChoices", () => {
  const who = people("usr_ana", [
    member("usr_ana", "Ana 10", "owner"),
    member("usr_bia", "Ana 2"),
    member("usr_caio", null),
  ]);

  test("sorts by name, numbers in order, a member without a name included", () => {
    const choices = memberChoices(
      data({ members: [...who.members.values()] }),
      "usr_ana",
      who,
      "en",
    );
    expect(choices.map((choice) => choice.name)).toEqual(["Ana 2", "Ana 10", "Unnamed member"]);
  });

  test("keeps the member shown even when they are no longer listed", () => {
    const choices = memberChoices(data({ members: [] }), "usr_gone", who, "pt-BR");
    expect(choices.map((choice) => choice.id)).toEqual(["usr_gone"]);
  });
});

describe("canPageAgain", () => {
  test("owners and admins, while the incident is active and unacknowledged", () => {
    expect(canPageAgain("owner", incident())).toBe(true);
    expect(canPageAgain("admin", incident())).toBe(true);
    expect(canPageAgain("responder", incident())).toBe(false);
    expect(canPageAgain("viewer", incident())).toBe(false);
  });

  test("not once acknowledged or no longer active", () => {
    expect(canPageAgain("owner", incident({ acknowledgedAt: T, acknowledgedBy: "usr_bia" }))).toBe(
      false,
    );
    expect(canPageAgain("owner", incident({ status: "resolved" }))).toBe(false);
    expect(canPageAgain("owner", incident({ status: "declined" }))).toBe(false);
  });
});
