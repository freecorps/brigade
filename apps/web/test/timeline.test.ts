import { setLocale } from "@freecorps/brigade-i18n";
import { UPDATE_BODY_MAX, type MemberRow, type TimelineRow } from "@freecorps/brigade-schema";
import { afterEach, expect, test } from "vite-plus/test";
import { parseIncidentNumber } from "../src/components/incident-detail";
import { noticeText, type Notice } from "../src/lib/incidents";
import {
  assignable,
  bodyParts,
  checkUpdate,
  entryText,
  entryTime,
  itemText,
  pagesFailedNames,
  people,
  personName,
  timelineItems,
  updateLength,
  type TimelineItem,
} from "../src/lib/timeline";

afterEach(() => setLocale("en"));

const ID = "inc_01M5PWGDG00000000000000001";
const member = (
  id: string,
  name: string | null,
  role: MemberRow["role"] = "responder",
): MemberRow => ({
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
  expect(personName("sys_monitors", who)).toBe("A monitor");
  expect(personName("usr_gone", who)).toBe("A teammate");
  // Listed, but with a name the shard could not keep.
  expect(personName("usr_x", people("usr_me", [member("usr_x", null)]))).toBe("Unnamed member");
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
    entry({ kind: "page_failed", actor: "sys_notifier", userId: "usr_bia", reason: "undelivered" }),
    entry({ kind: "page_failed", actor: "sys_notifier", userId: "usr_me", reason: "unsupported" }),
    entry({
      kind: "page_failed",
      actor: "sys_notifier",
      userId: "usr_bia",
      reason: "not_configured",
    }),
    entry({ kind: "page_failed", actor: "sys_notifier", userId: null, reason: "no_devices" }),
    entry({ kind: "page_failed", actor: "sys_notifier", userId: "usr_bia", reason: "no_devices" }),
    entry({ kind: "page_failed", actor: "sys_notifier", userId: "usr_bia", reason: "over_limit" }),
    entry({ kind: "page_failed", actor: "sys_notifier", userId: null, reason: "dead_lettered" }),
    entry({
      kind: "page_failed",
      actor: "sys_notifier",
      userId: "usr_bia",
      reason: "dead_lettered",
    }),
  ];
  const english = entries.map((item) => entryText(item, who));
  expect(english).toEqual([
    "Bia Lima declared the incident as SEV1 Critical",
    "Bia Lima changed the status from Triage to Fixing",
    "Bia Lima changed the severity from SEV3 Medium to SEV2 High",
    "You acknowledged the page",
    "Bia Lima made you incident commander",
    "Bia Lima removed you as communications lead",
    "Bia Lima took the operations lead role",
    "Bia Lima stepped down as operations lead",
    "Bia Lima posted an update",
    "Checkout API recovered, so its alert resolved",
    "Bia Lima paused Checkout API, so its alert resolved",
    "Bia Lima deleted Checkout API, so its alert resolved",
    "Couldn't page Bia Lima: the push didn't go through",
    "Couldn't page you: Brigade can't push to Android phones yet",
    "Couldn't page Bia Lima: push notifications aren't set up on this server",
    "Nobody was paged: no one who can respond has Brigade on their phone",
    "Couldn't page Bia Lima: no registered device",
    "Couldn't page Bia Lima: this page went to too many phones",
    "A page may not have gone out: Brigade kept failing to send it",
    "A page may not have gone out: Brigade kept failing to send it",
  ]);
  await setLocale("pt-BR");
  const portuguese = entries.map((item) => entryText(item, who));
  expect(portuguese[0]).toBe("Bia Lima declarou o incidente como SEV1 Crítica");
  expect(portuguese[1]).toBe("Bia Lima mudou o status de Triagem para Corrigindo");
  expect(portuguese[4]).toBe("Bia Lima definiu você como comandante do incidente");
  expect(portuguese.slice(-4)).toEqual([
    "Não foi possível chamar Bia Lima: nenhum aparelho registrado",
    "Não foi possível chamar Bia Lima: a chamada foi para celulares demais",
    "Uma chamada pode não ter saído: o Brigade não conseguiu enviá-la",
    "Uma chamada pode não ter saído: o Brigade não conseguiu enviá-la",
  ]);
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
    /^Couldn't change the operations lead\. /,
  );
});

test("an update over the limit is too long, counted as the shard counts it", () => {
  expect(checkUpdate(ID, "x".repeat(UPDATE_BODY_MAX + 1))).toEqual({ ok: false, reason: "long" });
  // Pasted far past the limit: still "too long", not "invalid".
  expect(checkUpdate(ID, "x".repeat(UPDATE_BODY_MAX * 3))).toEqual({ ok: false, reason: "long" });
  // Surrounding space does not count.
  expect(checkUpdate(ID, `  ${"x".repeat(UPDATE_BODY_MAX)}\n\n`).ok).toBe(true);
  expect(updateLength(`  ${"x".repeat(10)}\n`)).toBe(10);
});

test("links in an update are found, without the punctuation that ends the sentence", () => {
  expect(
    bodyParts("See https://status.example.com/incidents/42. Also (http://example.org/a), done"),
  ).toEqual([
    { text: "See " },
    { url: "https://status.example.com/incidents/42" },
    { text: ". Also (" },
    { url: "http://example.org/a" },
    { text: "), done" },
  ]);
  expect(bodyParts("https://en.wikipedia.org/wiki/Mars_(planet)")).toEqual([
    { url: "https://en.wikipedia.org/wiki/Mars_(planet)" },
  ]);
  // Not links: other schemes, a scheme alone, markup.
  for (const text of ["javascript:alert(1)", "https://", "ftp://example.com", "<b>hi</b>"]) {
    expect(bodyParts(text), text).toEqual([{ text }]);
  }
});

test("timeline times: the clock and how long ago for a day, then the date", () => {
  const now = Date.UTC(2026, 9, 25, 14, 11);
  expect(entryTime(now - 6 * 60_000, now, "en", "UTC")).toBe("2:05 PM · 6 minutes ago");
  expect(entryTime(now - 30_000, now, "en", "UTC")).toBe("2:10 PM · just now");
  expect(entryTime(now - 25 * 60 * 60_000, now, "en", "UTC")).toBe("Oct 24, 2026, 1:11 PM");
  expect(entryTime(now - 6 * 60_000, now, "pt-BR", "UTC")).toBe("14:05 · há 6 minutos");
  // A clock a little ahead never says "in 3 seconds".
  expect(entryTime(now + 3000, now, "en", "UTC")).toBe("2:11 PM · just now");
});

test("incident numbers in the URL", () => {
  expect(parseIncidentNumber("12")).toBe(12);
  for (const bad of ["0", "012", "-1", "1.5", "INC-12", "", "99999999999999999"]) {
    expect(parseIncidentNumber(bad), bad).toBeNull();
  }
});

test("pages one run could not send for the same reason are one line, with the names behind it", async () => {
  const failed = (n: number, userId: string | null, reason = "no_devices", at = 5) =>
    entry({ id: `${ID}:${n}`, kind: "page_failed", actor: "sys_notifier", userId, reason, at });
  const update = entry({ id: `${ID}:9`, kind: "update", body: "On it" });
  const entries = [
    update,
    failed(8, "usr_me"),
    failed(7, "usr_bia"),
    failed(6, "usr_gone"),
    // Another reason, a later run, nobody and a dead letter each stand alone.
    failed(5, "usr_cai", "undelivered"),
    failed(4, "usr_dan", "no_devices", 1),
    failed(3, null),
    failed(2, null, "dead_lettered"),
  ];
  const items = timelineItems(entries);
  expect(
    items.map((item) => (item.kind === "entry" ? item.entry.id : item.entries.length)),
  ).toEqual([`${ID}:9`, 3, `${ID}:5`, `${ID}:4`, `${ID}:3`, `${ID}:2`]);
  const group = items[1] as Extract<TimelineItem, { kind: "pages_failed" }>;
  expect(group).toMatchObject({ key: `${ID}:8`, at: 5, reason: "no_devices" });
  expect(itemText(group, who)).toBe("Couldn't page 3 people: no registered device");
  // Alphabetical in the reader's language, not the timeline's order.
  expect(pagesFailedNames(group, who, "en").map(({ name }) => name)).toEqual([
    "A teammate",
    "Bia Lima",
    "You",
  ]);
  expect(pagesFailedNames(group, who, "en").map(({ id }) => id)).toEqual([
    `${ID}:6`,
    `${ID}:7`,
    `${ID}:8`,
  ]);
  expect(itemText(items[0]!, who)).toBe(entryText(update, who));
  await setLocale("pt-BR");
  expect(
    itemText({ ...group, entries: Array(21).fill(group.entries[0]) as typeof group.entries }, who),
  ).toBe("Não foi possível chamar 21 pessoas: nenhum aparelho registrado");
  // One failure is never grouped.
  expect(timelineItems([failed(1, "usr_bia")])).toEqual([
    { kind: "entry", entry: failed(1, "usr_bia") },
  ]);
});
