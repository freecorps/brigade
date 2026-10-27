// The ephemeral answers to what a Slack user asked (RFC 0011 "Commands"), in the language the bridge chose. Shared:
// this Worker answers through `response_url`, and the API answers an Events API message (`!update`) itself with
// `chat.postEphemeral`, since such a message has no `response_url`.

import { incident_role, slack_text } from "@freecorps/brigade-i18n/messages";
import { severityLabels } from "@freecorps/brigade-i18n/labels";
import { formatIncidentNumber, isBuiltinRole, type SlackLocale } from "@freecorps/brigade-schema";
import type { SlackActResult, SlackRoleName } from "./bridge.ts";
import { escapeMrkdwn, NO_ARGS } from "./notifier.ts";

/** The subcommand a `which` answer suggests, by what was asked. */
export type SlackVerb = "ack" | "update" | "sev" | "resolve" | "role" | "escalate";

/** A role as a sentence names it: a built-in translated ("incident commander"), a workspace role by its name. */
export function roleName(role: SlackRoleName, locale: SlackLocale): string {
  if (role.name !== null) return escapeMrkdwn(role.name);
  return incident_role(
    { role: isBuiltinRole(role.id) ? role.id : "deleted", form: "sentence" },
    { locale },
  );
}

/**
 * The answer to an action. Titles and names are escaped: people's text. `verb` words the `which` answer; `assignee`
 * is the Slack user `/inc role` named, mentioned as Slack shows them, and `typedRole` the role as they typed it.
 */
export function replyText(
  result: SlackActResult,
  options: { verb?: SlackVerb; assignee?: string; typedRole?: string } = {},
): string {
  const { incident, locale, workspaceName } = result;
  const args = {
    ...NO_ARGS,
    incident: (incident && formatIncidentNumber(incident.number)) ?? "",
    title: incident ? escapeMrkdwn(incident.title) : "",
    workspace: escapeMrkdwn(workspaceName),
    person: options.assignee ? `<@${options.assignee}>` : "",
  };
  const say = (part: string, more: Partial<typeof args> = {}) =>
    slack_text({ ...args, ...more, part }, { locale });
  if (result.ok) {
    switch (result.did) {
      case "declared":
        return say("reply_declared");
      case "acknowledged":
        return say("reply_acknowledged");
      case "updated":
        return say("reply_updated");
      case "severity": {
        const severity = result.severity ?? "sev3";
        const label = severityLabels[severity]({}, { locale });
        return say("reply_severity", { detail: `${severity.toUpperCase()} · ${label}` });
      }
      case "resolved":
        return say("reply_resolved");
      case "role":
        return say("reply_role", {
          detail: result.role ? roleName(result.role, locale) : "",
        });
      case "escalated":
        return say("reply_escalated");
    }
  }
  switch (result.code) {
    case "ambiguous":
    case "which": {
      const choices = (result.choices ?? []).map((number) => formatIncidentNumber(number)!);
      return say(result.code === "ambiguous" ? "reply_ambiguous" : "reply_which", {
        list: choices.join(", "),
        incident: choices[0] ?? "INC-1",
        detail: options.verb ?? "ack",
      });
    }
    case "already":
      return say("reply_already");
    case "not_active":
      return say("reply_not_active");
    case "not_found":
      return say("reply_not_found");
    case "none":
      return say("reply_none");
    case "no_active":
      return say("reply_no_active");
    case "unchanged":
      return say("reply_unchanged");
    case "not_escalating":
      return say("reply_not_escalating");
    case "forbidden":
      return say("reply_forbidden");
    case "unmapped":
      return say("reply_unmapped");
    case "not_connected":
      return say("reply_not_connected");
    case "unreadable":
      return say("reply_reconnect");
    case "unconfirmed":
      return say("reply_unconfirmed");
    case "invalid_title":
      return say("reply_invalid_title");
    case "invalid_update":
      return say("reply_invalid_update");
    case "unknown_role":
      return say("reply_unknown_role", {
        list: (result.roles ?? []).map((role) => roleName(role, locale)).join(", "),
        detail: escapeMrkdwn(options.typedRole ?? ""),
      });
    case "role_unmapped":
      return say("reply_role_unmapped");
    case "role_viewer":
      return say("reply_role_viewer");
    case "not_incident_channel":
      return say("reply_not_incident_channel");
    case "failed":
      return say("reply_failed");
  }
}
