// `/inc` (RFC 0011 "Commands"): what the text after the command asks for. Titles, updates and roles are checked by
// the mutations themselves in the shard; this only splits the words. The manifest asks Slack to escape the text
// (`should_escape: true`), so a user is `<@U…|name>` and `&`, `<`, `>` arrive as entities: `plainText` undoes that
// for what people wrote, and `/inc role` reads the user it names.

import { SEVERITIES, type Severity } from "@freecorps/brigade-schema";

/** Which incident a subcommand is about, when it names one (`INC-12`); else the channel's, or the only active one. */
type Target = { number?: number };

export type ParsedCommand =
  /** `title` empty: `/inc declare` alone, which opens the form. */
  | { kind: "declare"; title: string; severity: Severity }
  | ({ kind: "ack" } & Target)
  | ({ kind: "update"; body: string } & Target)
  | ({ kind: "severity"; severity: Severity } & Target)
  | ({ kind: "resolve" } & Target)
  /** `role` as typed (a role's name or id); `user` the Slack user it is given to. */
  | ({ kind: "role"; role: string; user: string } & Target)
  | ({ kind: "escalate" } & Target)
  | { kind: "help" }
  /** A subcommand this does not have, or one missing what it needs. */
  | { kind: "unknown" };

/** What `/inc declare` uses without a severity: the dashboard's default. */
export const DEFAULT_SEVERITY: Severity = "sev3";

/** Slack's whitespace in a command's text: spaces, tabs and newlines, which a pasted title may carry. */
const SPACE = /\s+/;
/** `INC-12`, or `12` where a number cannot be mistaken for text. */
const INCIDENT = /^(?:inc-)?(\d{1,9})$/i;
const NAMED_INCIDENT = /^inc-(\d{1,9})$/i;
/** A user as Slack escapes it: `<@U123>` or `<@U123|name>`. */
const USER = /^<@([UW][A-Z0-9]{2,30})(?:\|[^>]*)?>$/;

/** `12` or `INC-12` as a number above 0; undefined for anything else. */
function incidentNumber(word: string | undefined, pattern = INCIDENT): number | undefined {
  const match = word === undefined ? null : pattern.exec(word);
  const number = match ? Number(match[1]) : 0;
  return number > 0 ? number : undefined;
}

/** `1`, `sev1`, `SEV-1` as a severity. */
function severityOf(word: string | undefined): Severity | undefined {
  const value = word?.toLowerCase().replace(/^sev-?/, "");
  return SEVERITIES.find((severity) => severity === `sev${value}`);
}

/**
 * What a person wrote, from Slack's escaped form: `<@U1|ana>` reads `@ana`, `<#C1|general>` reads `#general`,
 * `<!here>` reads `@here`, a link reads as its address, and `&amp;`, `&lt;`, `&gt;` as the characters. The notifier
 * escapes it again wherever it is shown, so none of these can ping or link from a title.
 */
export function plainText(text: string): string {
  return text
    .replace(/<([^<>]*)>/g, (_whole, inner: string) => {
      const [target = "", label] = inner.split("|", 2);
      if (target.startsWith("@")) return label ? `@${label}` : target;
      if (target.startsWith("#")) return label ? `#${label}` : target;
      if (target.startsWith("!subteam^")) return label ?? "@team";
      if (target.startsWith("!")) return `@${target.slice(1).split("^")[0]}`;
      return target;
    })
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

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
    // Empty: the form, which asks for the title (and starts at this severity when one was given).
    return {
      kind: "declare",
      title: plainText(words.join(" ")),
      severity: severity ?? DEFAULT_SEVERITY,
    };
  }
  if (sub === "ack" || sub === "acknowledge") return simple("ack", rest);
  if (sub === "resolve") return simple("resolve", rest);
  if (sub === "escalate") return simple("escalate", rest);
  if (sub === "update") {
    // Only `INC-12` names an incident here: `update 12 servers are back` is an update that starts with a number.
    const number = incidentNumber(rest[0], NAMED_INCIDENT);
    // The text keeps its own line breaks: everything after the subcommand (and the number), as written.
    const after = trimmed.slice(first.length).trimStart();
    const body = plainText(
      number === undefined ? after : after.slice(rest[0]!.length).trimStart(),
    ).trim();
    if (body === "") return { kind: "unknown" };
    return { kind: "update", body, ...(number === undefined ? {} : { number }) };
  }
  if (sub === "sev" || sub === "severity") {
    const [one, two, ...more] = rest;
    if (more.length > 0 || one === undefined) return { kind: "unknown" };
    const number = two === undefined ? undefined : incidentNumber(one);
    const severity = severityOf(two ?? one);
    if (!severity || (two !== undefined && number === undefined)) return { kind: "unknown" };
    return { kind: "severity", severity, ...(number === undefined ? {} : { number }) };
  }
  if (sub === "role") {
    const words = [...rest];
    const number = words.length > 2 ? incidentNumber(words[0]) : undefined;
    if (number !== undefined) words.shift();
    const user = USER.exec(words.at(-1) ?? "")?.[1];
    words.pop();
    const role = words.join(" ");
    if (!user || role === "") return { kind: "unknown" };
    return { kind: "role", role, user, ...(number === undefined ? {} : { number }) };
  }
  return { kind: "unknown" };
}

/** A subcommand that takes nothing or an incident's number. */
function simple(kind: "ack" | "resolve" | "escalate", rest: string[]): ParsedCommand {
  if (rest.length === 0) return { kind };
  if (rest.length > 1) return { kind: "unknown" };
  const number = incidentNumber(rest[0]);
  return number === undefined ? { kind: "unknown" } : { kind, number };
}
