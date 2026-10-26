// "Why wasn't I paged?" worded (RFC 0006 "Delivery receipts"): the explanation itself is `whyPaged` in
// packages/sync, pure and string-free; this turns its parts into sentences in the current locale.
import { m } from "@freecorps/brigade-i18n";
import { personName, type People } from "@freecorps/brigade-i18n/incident";
import type {
  DeliveryRow,
  DeliveryStage,
  DeviceSummaryRow,
  MemberRow,
  PageFailure,
} from "@freecorps/brigade-schema";
import type { WhyEmail, WhyPage, WhyPaged, WhyVerdict } from "@freecorps/brigade-sync";

export { whyPaged, type WhyPaged, type WhyPage, type WhyVerdict } from "@freecorps/brigade-sync";

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

/** The answer in one line, for the full view. */
export function verdictText(verdict: WhyVerdict, name: string): string {
  return say(`verdict_${verdict}`, { name });
}

/** The answer in a word or two, for the incident page's list. */
export function shortVerdict(verdict: WhyVerdict): string {
  return say(`short_${verdict}`);
}

/** How a verdict looks: good news, a warning, or neutral. */
export function verdictTone(verdict: WhyVerdict): "ok" | "warn" | "neutral" {
  if (verdict === "delivered") return "ok";
  if (verdict === "failed" || verdict === "missed") return "warn";
  return "neutral";
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

/** Each stage of one device's page and when it happened (null: not reached). */
export function stageTimes(row: DeliveryRow): { stage: DeliveryStage; at: number | null }[] {
  return [
    { stage: "planned", at: row.plannedAt },
    { stage: "sent", at: row.sentAt },
    { stage: "accepted", at: row.acceptedAt },
    { stage: "delivered", at: row.deliveredAt },
  ];
}

export function stageText(stage: DeliveryStage): string {
  return say(`stage_${stage}`);
}

/** Why the last attempt failed, with Apple's own reason when it gave one; null when it did not fail. */
export function deliveryError(row: DeliveryRow): string[] {
  if (row.error === null) return [];
  const lines = [say(`error_${row.error}`)];
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
