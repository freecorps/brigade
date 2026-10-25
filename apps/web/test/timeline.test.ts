import { setLocale } from "@freecorps/brigade-i18n";
import { UPDATE_BODY_MAX, type MemberRow, type TimelineRow } from "@freecorps/brigade-schema";
import { afterEach, expect, test } from "vite-plus/test";
import { parseIncidentNumber } from "../src/components/incident-detail";
import { noticeText, type Notice } from "../src/lib/incidents";
import { assignable, checkUpdate, entryText, people, personName } from "../src/lib/timeline";

afterEach(() => setLocale("en"));

const ID = "inc_01M5PWGDG00000000000000001";
const member = (id: string, name: string, role: MemberRow["role"] = "responder"): MemberRow => ({
  id,
  name,
  role,
  updatedAt: 0,
});
const who = people("usr_me", [member("usr_me", "Me"), member("usr_bia", "Bia Lima")]);
const entry = (fields: Record<string, unknown>): TimelineRow =>
  ({ id: `${ID}:1`, incidentId: ID, seq: 1, at: 0, actor: "usr_bia", ...fields }) as TimelineRow;

test("people are named from the member list; the signed-in member is you; nobody is a raw id", () => {
  expect(personName("usr_me", who)).toBe("You");
  expect(personName("usr_me", who, "object")).toBe("you");
  expect(personName("usr_bia", who)).toBe("Bia Lima");
  expect(personName("sys_monitors", who)).toBe("Monitors");
  expect(personName("usr_gone", who)).toBe("A teammate");
});

test("every kind of entry reads as a sentence, in English and Portuguese", async () => {
  const entries = [
    entry({ kind: "declared", title: "t", severity: "sev1" }),
    entry({ kind: "status_changed", from: "triage", to: "fixing" }),
    entry({ kind: "severity_changed", from: "sev3", to: "sev2" }),
    entry({ kind: "acknowledged", actor: "usr_me" }),
    entry({ kind: "role_assigned", role: "commander", from: null, to: "usr_me" }),
    entry({ kind: "role_assigned", role: "communications", from: "usr_me", to: null }),
    entry({ kind: "role_assigned", role: "operations", from: null, to: "usr_bia" }),
    entry({ kind: "role_assigned", role: "operations", from: "usr_bia", to: null }),
    entry({ kind: "update", body: "x" }),
    entry({
      kind: "alert_resolved",
      actor: "sys_monitors",
      monitorId: "mon_1",
      monitor: "Checkout API",
      reason: "recovered",
    }),
    entry({
      kind: "alert_resolved",
      monitorId: "mon_1",
      monitor: "Checkout API",
      reason: "paused",
    }),
    entry({
      kind: "alert_resolved",
      monitorId: "mon_1",
      monitor: "Checkout API",
      reason: "deleted",
    }),
  ];
  const english = entries.map((item) => entryText(item, who));
  expect(english).toEqual([
    "Bia Lima declared the incident as SEV1 Critical",
    "Bia Lima moved it from Triage to Fixing",
    "Bia Lima changed the severity from SEV3 Medium to SEV2 High",
    "You acknowledged the page",
    "Bia Lima made you Incident commander",
    "Bia Lima removed you as Communications lead",
    "Bia Lima took the Operations lead role",
    "Bia Lima stepped down as Operations lead",
    "Bia Lima posted an update",
    "Checkout API recovered, so its alert resolved",
    "Bia Lima paused Checkout API, so its alert resolved",
    "Bia Lima deleted Checkout API, so its alert resolved",
  ]);
  await setLocale("pt-BR");
  const portuguese = entries.map((item) => entryText(item, who));
  expect(portuguese[0]).toBe("Bia Lima declarou o incidente como SEV1 Crítica");
  expect(portuguese[4]).toBe("Bia Lima definiu você como Comandante do incidente");
  // Every entry is worded in Portuguese, none falls back to English.
  for (const [index, text] of portuguese.entries())
    expect(text, String(index)).not.toBe(english[index]);
});

test("only members who may run incidents can hold a role", () => {
  expect(
    assignable([
      member("usr_a", "A"),
      member("usr_v", "V", "viewer"),
      member("usr_o", "O", "owner"),
    ]).map((item) => item.id),
  ).toEqual(["usr_a", "usr_o"]);
});

test("an update is checked like the shard checks it before it is sent", () => {
  expect(checkUpdate(ID, "  Rolled back.\n")).toEqual({
    ok: true,
    args: { id: ID, body: "Rolled back." },
  });
  expect(checkUpdate(ID, " \n\t")).toEqual({ ok: false, reason: "empty" });
  expect(checkUpdate(ID, `Fine ${String.fromCodePoint(0x202e)}`)).toEqual({
    ok: false,
    reason: "invalid",
  });
  expect(checkUpdate(ID, "x".repeat(UPDATE_BODY_MAX)).ok).toBe(true);
});

test("a refused update or role change says what failed", () => {
  const base = { key: "n1", reason: "forbidden", incidentId: ID, number: 3, title: "t" } as const;
  expect(noticeText({ ...base, kind: "update" } as Notice, "row")).toBe(
    "Couldn't post the update. You don't have permission to do that.",
  );
  expect(noticeText({ ...base, kind: "role", role: "operations" } as Notice, "row")).toMatch(
    /^Couldn't change the Operations lead\. /,
  );
});

test("incident numbers in the URL", () => {
  expect(parseIncidentNumber("12")).toBe(12);
  for (const bad of ["0", "012", "-1", "1.5", "INC-12", "", "99999999999999999"]) {
    expect(parseIncidentNumber(bad), bad).toBeNull();
  }
});
