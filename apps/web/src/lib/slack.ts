// The dashboard's side of the Slack app (RFC 0011): starting an install (the API's
// `POST /workspaces/:id/slack/install`, then the Slack Worker's `/slack/install`), reading how it ended (`?slack=` on
// the way back), and checking a channel id. Pure apart from `fetch`; tested in test/slack.test.tsx.
import { m } from "@freecorps/brigade-i18n";
import { isSlackChannelId } from "@freecorps/brigade-schema";

/** One of `slack_card`'s parts (packages/i18n). */
export type SlackCardPart = string;

/** The card's text for `part`, with the team's name and the channel filled in where it says so. */
export function slackText(part: string, args: { team?: string; channel?: string } = {}): string {
  return m.slack_card({ part, team: args.team ?? "", channel: args.channel ?? "" });
}

export type SlackInstallError =
  | "forbidden"
  | "not_a_member"
  | "not_configured"
  | "too_many"
  | "unavailable"
  | "network"
  | "internal";

/**
 * Starts connecting Slack: the API checks the member may, keeps a one-time state and sets the cookie the callback
 * checks; the answer is where to send the browser next (the Slack Worker, which goes on to Slack).
 */
export async function startSlackInstall(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; url: string } | { ok: false; error: SlackInstallError }> {
  let response: Response;
  try {
    response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}/slack/install`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, error: "network" };
  }
  const body = (await response.json().catch(() => ({}))) as { state?: unknown; error?: unknown };
  if (response.ok && typeof body.state === "string") {
    return { ok: true, url: `/slack/install?state=${encodeURIComponent(body.state)}` };
  }
  const known: SlackInstallError[] = [
    "forbidden",
    "not_a_member",
    "not_configured",
    "too_many",
    "unavailable",
  ];
  const error = known.find((code) => code === body.error);
  return { ok: false, error: error ?? "internal" };
}

/** How an install that came back to the dashboard (`?slack=<outcome>`) reads on the card; null without one. */
export function slackResult(search: string): { ok: boolean; part: SlackCardPart } | null {
  const outcome = new URLSearchParams(search).get("slack");
  if (outcome === null) return null;
  if (outcome === "connected") return { ok: true, part: "result_connected" };
  if (outcome === "cancelled") return { ok: false, part: "result_cancelled" };
  if (outcome === "team_taken") return { ok: false, part: "result_team_taken" };
  if (outcome === "not_configured") return { ok: false, part: "result_not_configured" };
  if (outcome === "forbidden") return { ok: false, part: "manage_only" };
  return { ok: false, part: "result_failed" };
}

/** Why an install could not start, as the card says it. */
export function installErrorPart(error: SlackInstallError): SlackCardPart {
  if (error === "not_configured") return "result_not_configured";
  if (error === "forbidden" || error === "not_a_member") return "manage_only";
  return "result_failed";
}

/** A typed channel id: trimmed; empty means none; anything else must be a `C…` or `G…` id. */
export function checkChannel(input: string): { ok: true; value: string | null } | { ok: false } {
  const value = input.trim();
  if (value === "") return { ok: true, value: null };
  return isSlackChannelId(value) ? { ok: true, value } : { ok: false };
}
