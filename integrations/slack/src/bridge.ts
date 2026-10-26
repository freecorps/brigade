// The contract between this Worker and the API's `SlackBridge` entrypoint (apps/api src/slack-bridge.ts), RFC 0011
// "Shape". The API implements it; this Worker calls it through the `API` service binding. Every D1 read and every
// shard write happens on the API's side, so this Worker holds no binding to either.

import type { Severity, SlackLocale } from "@freecorps/brigade-schema";

/** A Slack team connected to a Brigade workspace, with the bot token decrypted for this request only. */
export type SlackContext = {
  workspaceId: string;
  workspaceName: string;
  /** The bot token (`xoxb-…`). Never logged, never stored here. */
  token: string;
  /** The language of the connection's channel messages: the last fallback for a reply. */
  locale: SlackLocale;
};

/** What a Slack user asked for: `/inc declare`, or `/inc ack` and the Acknowledge button. */
export type SlackAction =
  | { kind: "declare"; title: string; severity: Severity }
  /** `incidentId` from the button, `number` from `/inc ack 12`; neither: the only incident waiting for one. */
  | { kind: "ack"; incidentId?: string; number?: number };

export type SlackActRequest = {
  teamId: string;
  /** The Slack user's email, confirmed by Slack, which maps them to a member. */
  email: string;
  action: SlackAction;
  /**
   * Names this request (a hash of the command's `trigger_id`, or of the click), so a replayed or repeated request
   * runs its mutation once and gets the same answer.
   */
  key: string;
};

export type SlackIncident = { id: string; number: number | null; title: string };

/** Why an action did not run, or did not change anything. */
export type SlackActRefusal =
  /** The team is not (or no longer) connected to a workspace. */
  | "not_connected"
  /** No member of the workspace has this email (or their role is not a Brigade role). */
  | "unmapped"
  /** The member's role cannot do it (a viewer). */
  | "forbidden"
  /** Someone already acknowledged it. */
  | "already"
  /** Resolved or declined. */
  | "not_active"
  | "not_found"
  /** Several incidents wait for an acknowledgement: `choices` lists them. */
  | "ambiguous"
  /** None does. */
  | "none"
  | "invalid_title"
  /** Anything else: D1 or the shard down, a bug. Try again. */
  | "failed";

export type SlackActResult =
  | {
      ok: true;
      did: "declared" | "acknowledged";
      incident: SlackIncident;
      locale: SlackLocale | null;
    }
  | {
      ok: false;
      code: SlackActRefusal;
      /** The member's own language, when the email mapped to one. */
      locale: SlackLocale | null;
      incident?: SlackIncident;
      /** Incident numbers to pick from (`ambiguous`), at most five. */
      choices?: number[];
    };

/** What Slack's `oauth.v2.access` gave, for `completeInstall`. */
export type SlackInstall = {
  teamId: string;
  teamName: string;
  botUserId: string;
  /** The bot token: the API encrypts it before the shard stores it. */
  token: string;
  scopes: string[];
};

export type SlackInstallRefusal =
  /** No such state, used already, or expired: the install started elsewhere or too long ago. */
  | "invalid_state"
  /** The member who started it is no longer an owner or admin. */
  | "forbidden"
  /** Another Brigade workspace has this Slack team. */
  | "team_taken"
  /** The API has no `SLACK_TOKEN_KEY`. */
  | "not_configured"
  | "failed";

export type SlackInstallResult = { ok: true } | { ok: false; code: SlackInstallRefusal };

/** The API's `SlackBridge` entrypoint, as this Worker calls it. */
export interface SlackBridgeApi {
  /** The workspace connected to `teamId`, with its token; null when none is. */
  context(teamId: string): Promise<SlackContext | null>;
  /** Runs `incident.declare` or `incident.ack` as the member the email maps to. */
  act(request: SlackActRequest): Promise<SlackActResult>;
  /** Finishes an install: takes the one-time state and connects the team as the member who started it. */
  completeInstall(state: string, install: SlackInstall): Promise<SlackInstallResult>;
}
