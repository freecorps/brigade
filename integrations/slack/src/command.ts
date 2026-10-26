// `/inc` (RFC 0011 "Commands"): what the text after the command asks for. Titles are checked by `incident.declare`
// itself in the shard; this only splits the words.

import { SEVERITIES, type Severity } from "@freecorps/brigade-schema";

export type ParsedCommand =
  | { kind: "declare"; title: string; severity: Severity }
  | { kind: "ack"; number?: number }
  | { kind: "help" }
  /** A subcommand this slice does not have, or `declare` without a title, `ack` with something that is no number. */
  | { kind: "unknown" };

/** What `/inc declare` uses without a severity: the dashboard's default. */
export const DEFAULT_SEVERITY: Severity = "sev3";

/** Slack's whitespace in a command's text: spaces, tabs and newlines, which a pasted title may carry. */
const SPACE = /\s+/;

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "help" };
  const [first = "", ...rest] = trimmed.split(SPACE);
  const sub = first.toLowerCase();
  if (sub === "help") return { kind: "help" };
  if (sub === "declare") {
    const words = [...rest];
    const last = words.at(-1)?.toLowerCase();
    const severity = SEVERITIES.find((value) => value === last);
    if (severity) words.pop();
    const title = words.join(" ");
    // "declare" or "declare sev1" alone has no title: the usage, rather than an incident named "sev1".
    if (title === "") return { kind: "unknown" };
    return { kind: "declare", title, severity: severity ?? DEFAULT_SEVERITY };
  }
  if (sub === "ack" || sub === "acknowledge") {
    if (rest.length === 0) return { kind: "ack" };
    if (rest.length > 1) return { kind: "unknown" };
    const match = /^(?:inc-)?(\d{1,9})$/i.exec(rest[0]!);
    if (!match) return { kind: "unknown" };
    const number = Number(match[1]);
    return number > 0 ? { kind: "ack", number } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}
