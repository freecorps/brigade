// "Why wasn't I paged?" worded (RFC 0006 "Delivery receipts"), shared by the dashboard and the mobile app: the
// explanation itself is `whyPaged` in packages/sync, pure and string-free; this turns its parts into sentences in
// the current locale.
import type {
  CallChoice,
  DeliveryRow,
  DeliveryStage,
  DeviceSummaryRow,
  MemberRow,
  PageFailure,
} from "@freecorps/brigade-schema";
import type {
  WhyCall,
  WhyEmail,
  WhyMiss,
  WhyPage,
  WhyPaged,
  WhyVerdict,
} from "@freecorps/brigade-sync";
import { personName, type People } from "./incident.ts";
import { m } from "./paraglide/messages.js";

const say = (text: string, fields: { name?: string; time?: string; detail?: string } = {}) =>
  m.page_why({
    text,
    name: fields.name ?? "",
    time: fields.time ?? "",
    detail: fields.detail ?? "",
  });

export const whyText = say;

/**
 * A member's name as a sentence's subject, never "You": these sentences say "{name}'s phone" and "{name} wasn't on
 * call", which only read with a name. A member the shard has no name for is "A teammate", one it could not keep
 * "Unnamed member".
 */
export function memberName(id: string, who: People): string {
  return personName(id, { ...who, self: "" });
}

/**
 * The answer in one line, for the full view. A page that missed them says why, from the latest miss: "Brigade
 * couldn't page Inês: no phone registered".
 */
export function verdictText(why: Pick<WhyPaged, "verdict" | "pages">, name: string): string {
  if (why.verdict === "missed") {
    const latest = why.pages
      .flatMap((page) => page.misses)
      .reduce<WhyMiss | null>(
        (last, miss) => (last === null || miss.at >= last.at ? miss : last),
        null,
      );
    if (latest) return say("verdict_missed_reason", { name, detail: say(`miss_${latest.reason}`) });
  }
  return say(`verdict_${why.verdict}`, { name });
}

/** The answer in a word or two, for the incident page's list. */
export function shortVerdict(verdict: WhyVerdict): string {
  return say(`short_${verdict}`);
}

/** The calls of a member's pages in a word or two, for the incident page's list: "Call failed". */
export function shortCall(call: WhyCall): string {
  return say(`short_call_${call}`);
}

/** How a call's word looks: a failed or unsent call is a warning; the page itself says whether it got through. */
export function callTone(call: WhyCall): "ok" | "warn" | "neutral" {
  return call === "failed" || call === "not_sent" ? "warn" : "neutral";
}

/** Which pages ring the member's iPhones as a call, as they chose it. */
export function callChoiceText(choice: CallChoice, name: string): string {
  return say(`calls_choice_${choice}`, { name });
}

/** "Call · iPhone · App Store build". */
export function callLabel(row: Pick<DeviceSummaryRow, "platform" | "environment">): string {
  return say("call_label", { detail: deviceLabel(row) });
}

/** How a verdict looks: good news, a warning, or neutral. */
export function verdictTone(verdict: WhyVerdict): "ok" | "warn" | "neutral" {
  if (verdict === "delivered") return "ok";
  if (verdict === "failed" || verdict === "missed" || verdict === "stuck") return "warn";
  return "neutral";
}

/** The incident page lists whoever needs a look first: failed, couldn't page, stuck, sending, accepted, delivered. */
const URGENCY: readonly WhyVerdict[] = [
  "failed",
  "missed",
  "stuck",
  "sending",
  "accepted",
  "delivered",
];

/** Members by how urgently their paging needs a look (`URGENCY`, then the rest), each keeping its order otherwise. */
export function byUrgency<T extends { verdict: WhyVerdict }>(rows: readonly T[]): T[] {
  const rank = (verdict: WhyVerdict) => {
    const index = URGENCY.indexOf(verdict);
    return index === -1 ? URGENCY.length : index;
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row.verdict) - rank(b.row.verdict) || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * The pages to show in full: of each level's pages in a row with the same outcome for the member (other levels'
 * pages in between do not break the run), the latest, with how many came before it, in the latest's place. Twenty
 * rounds of "Level 1, Level 2" read as two pages.
 */
export function pageGroups(pages: readonly WhyPage[]): { page: WhyPage; earlier: number }[] {
  const groups: ({ page: WhyPage; earlier: number; key: string } | null)[] = [];
  const latest = new Map<string, number>();
  for (const page of pages) {
    const level = page.step === null ? "interim" : String(page.level);
    const key = outcomeKey(page);
    const index = latest.get(level);
    const prior = index === undefined ? null : groups[index]!;
    if (prior && prior.key === key) groups[index!] = null;
    groups.push({ page, earlier: prior && prior.key === key ? prior.earlier + 1 : 0, key });
    latest.set(level, groups.length - 1);
  }
  return groups.flatMap((group) => (group ? [{ page: group.page, earlier: group.earlier }] : []));
}

function outcomeKey(page: WhyPage): string {
  return JSON.stringify([
    page.targeted,
    [...page.deliveries, ...page.calls]
      .map(({ row, stage, stuck }) =>
        [row.deviceId, row.kind ?? "push", stage, row.error, row.reason, stuck].join("/"),
      )
      .sort(),
    page.misses.map((miss) => miss.reason).sort(),
  ]);
}

/** "Same outcome as 3 earlier pages to this level". */
export function sameOutcomeText(earlier: number): string {
  return earlier === 1 ? say("pages_same_one") : say("pages_same", { detail: String(earlier) });
}

export function memberText(status: WhyPaged["member"]["status"], name: string): string {
  return say(`step_${status}`, { name });
}

export function ruleText(rule: WhyPaged["rule"]): string {
  return rule.kind === "policy" ? say("rule_policy", { detail: rule.name }) : say("rule_interim");
}

/** "Level 2 · Round 1", "Everyone who can respond", or "Page" (the interim rule's). */
export function pageLabel(page: WhyPage): string {
  if (page.step === null) return say("page_interim");
  const level =
    page.level === null ? say("page_everyone") : say("page_level", { detail: String(page.level) });
  const parts = [level];
  if (page.round > 0) parts.push(say("page_round", { detail: String(page.round) }));
  if (page.again) parts.push(say("page_again"));
  return parts.join(" · ");
}

/** Whether a page was for them, and if not, why; with who it reached instead when that says something. */
export function targetedText(page: WhyPage, name: string, who: People): string[] {
  const lines: string[] = [];
  if (page.targeted === "not_on_call") {
    const schedules = page.schedules.filter((schedule): schedule is string => schedule !== null);
    lines.push(
      schedules.length > 0
        ? say("targeted_not_on_call", { name, detail: schedules.join(", ") })
        : say("targeted_not_on_call_plain", { name }),
    );
  } else {
    lines.push(say(`targeted_${page.targeted}`, { name }));
  }
  if (page.targeted !== "paged" && page.targeted !== "declarer" && page.reached.length > 0) {
    lines.push(
      say("targeted_instead", { detail: page.reached.map((id) => memberName(id, who)).join(", ") }),
    );
  }
  return lines;
}

/** "Couldn't page Bia: no registered device", as the timeline says it. */
export function missText(reason: PageFailure, name: string): string {
  return m.timeline_entry({ kind: `page_failed_${reason}`, actor: "", a: name, b: "" });
}

export const STAGES: readonly DeliveryStage[] = ["planned", "sent", "accepted", "delivered"];

/** A call's stages: Apple taking it is the last one Brigade learns (no receipt comes from a call). */
export const CALL_STAGES: readonly DeliveryStage[] = ["planned", "sent", "accepted"];

/**
 * Each stage of one device's page and when it happened (null: not reached). After a failed attempt or a page stuck
 * unsent, the first stage not reached is where it `stopped`.
 */
export function stageTimes(
  row: DeliveryRow,
  stuck = false,
): { stage: DeliveryStage; at: number | null; stopped: boolean }[] {
  const times = [
    { stage: "planned" as const, at: row.plannedAt },
    { stage: "sent" as const, at: row.sentAt },
    { stage: "accepted" as const, at: row.acceptedAt },
    { stage: "delivered" as const, at: row.deliveredAt },
  ];
  const halted = row.error !== null || stuck;
  const kept =
    row.kind === "call" ? times.filter(({ stage }) => CALL_STAGES.includes(stage)) : times;
  const first = kept.findIndex(({ at }) => at === null);
  return kept.map((time, index) => ({ ...time, stopped: halted && index === first }));
}

export function stageText(stage: DeliveryStage): string {
  return say(`stage_${stage}`);
}

/** Why the last attempt failed, with Apple's own reason when it gave one; null when it did not fail. */
export function deliveryError(row: DeliveryRow): string[] {
  if (row.error === null) return [];
  // A call's refused token stops only the calls: the phone stays, unlike a push's.
  const lines = [
    say(
      row.kind === "call" && row.error === "token_invalid"
        ? "call_error_token_invalid"
        : `error_${row.error}`,
    ),
  ];
  if (row.reason !== null) lines.push(say("apns_reason", { detail: row.reason }));
  return lines;
}

/** "iPhone · App Store build". */
export function deviceLabel(device: Pick<DeviceSummaryRow, "platform" | "environment">): string {
  return `${say(`platform_${device.platform}`)} · ${say(`env_${device.environment}`)}`;
}

export function emailText(email: WhyEmail, name: string): string {
  return say(`email_${email}`, { name });
}

/**
 * Who the incident page lists: everyone who can respond, plus anyone else a page touched (a viewer since, someone
 * gone), so nobody paged disappears from the list. Those a page reached or missed come first.
 */
export function pagingMembers(
  members: readonly MemberRow[],
  deliveries: readonly DeliveryRow[],
  touched: readonly string[],
): string[] {
  const involved = new Set([...deliveries.map((row) => row.userId), ...touched]);
  const ids = members.filter((row) => row.role !== "viewer").map((row) => row.id);
  for (const id of involved) if (!ids.includes(id)) ids.push(id);
  return [...ids.filter((id) => involved.has(id)), ...ids.filter((id) => !involved.has(id))];
}
