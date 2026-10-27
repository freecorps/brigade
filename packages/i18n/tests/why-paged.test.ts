import { setLocale } from "../src/index.ts";
import type { DeliveryRow } from "@freecorps/brigade-schema";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import type { WhyPage, WhyVerdict } from "@freecorps/brigade-sync";
import { byUrgency, pageGroups, stageTimes, verdictText } from "../src/why-paged.ts";

beforeEach(() => {
  void setLocale("en");
});

const T = Date.UTC(2026, 9, 26, 3, 0, 0);
const row = (fields: Partial<DeliveryRow> = {}): DeliveryRow => ({
  id: "inc_1:evt_1:dev_1",
  incidentId: "inc_1",
  eventId: "evt_1",
  deviceId: "dev_1",
  userId: "usr_bia",
  platform: "ios",
  environment: "production",
  run: null,
  step: null,
  plannedAt: T,
  sentAt: T + 200,
  acceptedAt: T + 400,
  deliveredAt: null,
  attempts: 1,
  error: null,
  reason: null,
  updatedAt: T,
  ...fields,
});
const page = (step: number, fields: Partial<WhyPage> = {}): WhyPage => ({
  step,
  level: 1,
  round: step - 1,
  at: T + step * 60_000,
  reason: "timeout",
  again: false,
  targeted: "paged",
  schedules: [],
  reached: [],
  deliveries: [],
  calls: [],
  misses: [{ reason: "no_devices", at: T + step * 60_000, schedule: null }],
  ...fields,
});

describe("the incident page's list", () => {
  test("whoever needs a look comes first", () => {
    const verdicts: WhyVerdict[] = [
      "none",
      "delivered",
      "accepted",
      "not_targeted",
      "sending",
      "stuck",
      "missed",
      "declarer",
      "failed",
    ];
    const sorted = byUrgency(verdicts.map((verdict, index) => ({ id: index, verdict })));
    expect(sorted.map((one) => one.verdict)).toEqual([
      "failed",
      "missed",
      "stuck",
      "sending",
      "accepted",
      "delivered",
      // The rest keep their order.
      "none",
      "not_targeted",
      "declarer",
    ]);
  });
});

describe("the step-by-step view", () => {
  test("a page that missed them says why, from the latest miss", () => {
    const why = {
      verdict: "missed" as const,
      pages: [page(1, { misses: [{ reason: "nobody_on_call", at: T, schedule: null }] }), page(2)],
    };
    expect(verdictText(why, "Inês")).toBe("Brigade couldn't page Inês: no phone registered");
    void setLocale("pt-BR");
    expect(verdictText(why, "Inês")).toBe(
      "O Brigade não conseguiu acionar Inês: nenhum celular registrado",
    );
  });

  test("a phone APNs refused says so, not that none was ever registered", () => {
    const why = {
      verdict: "missed" as const,
      pages: [page(1, { misses: [{ reason: "token_invalid", at: T, schedule: null }] })],
    };
    expect(verdictText(why, "you")).toBe(
      "Brigade couldn't page you: Apple refused this phone's token, so it was removed. Opening the Brigade app registers it again",
    );
    void setLocale("pt-BR");
    expect(verdictText(why, "Inês")).toContain("a Apple recusou o token deste celular");
  });

  test("twenty pages with the same outcome read as one per level, the latest", () => {
    // Twenty rounds alternating levels 1 and 2, as a repeating policy pages them.
    const pages = Array.from({ length: 20 }, (_, index) =>
      page(index + 1, {
        level: (index % 2) + 1,
        ...(index % 2 === 0 ? { misses: [], targeted: "not_on_call" as const } : {}),
      }),
    );
    const groups = pageGroups(pages);
    expect(groups.map(({ page: one, earlier }) => [one.step, one.level, earlier])).toEqual([
      [19, 1, 9],
      [20, 2, 9],
    ]);
    // A different outcome on a level starts a run of its own.
    const changed = pageGroups([page(1), page(2, { misses: [] }), page(3)]);
    expect(changed.map(({ earlier }) => earlier)).toEqual([0, 0, 0]);
  });

  test("after an error, the first stage not reached is where it stopped", () => {
    const refused = stageTimes(row({ acceptedAt: null, error: "apns_refused" }));
    expect(refused.map(({ stage, stopped }) => [stage, stopped])).toEqual([
      ["planned", false],
      ["sent", false],
      ["accepted", true],
      ["delivered", false],
    ]);
    // On its way, or only no receipt yet: nothing stopped.
    expect(stageTimes(row()).some(({ stopped }) => stopped)).toBe(false);
    // Stuck before it was sent.
    const stuck = stageTimes(row({ sentAt: null, acceptedAt: null }), true);
    expect(stuck.find(({ stopped }) => stopped)?.stage).toBe("sent");
  });
});
