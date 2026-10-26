// The contract between this Worker and the API's `SlackBridge` entrypoint (apps/api src/slack-bridge.ts), RFC 0011
// "Shape". The API implements it; this Worker calls it through the `API` service binding. Every D1 read, every shard
// write and every Web API call that needs the bot token happen on the API's side, so this Worker holds no binding to
// either and never sees a token: it answers Slack through each request's `response_url`, which needs none.

import type { Severity, SlackLocale } from "@freecorps/brigade-schema";

/** What a Slack user asked for: `/inc declare`, or `/inc ack` and the Acknowledge button. */
export type SlackAction =
  | { kind: "declare"; title: string; severity: Severity }
  /** `incidentId` from the button, `number` from `/inc ack 12`; neither: the only incident waiting for one. */
  | { kind: "ack"; incidentId?: string; number?: number };

/** Who asked: a Slack user (`U…`/`W…`) of a Slack team (`T…`), as Slack's signed request named them. */
export type SlackRequester = { teamId: string; slackUserId: string };

export type SlackActRequest = SlackRequester & {
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
  /** The team is connected, but its token cannot be opened (`SLACK_TOKEN_KEY` changed): it must reconnect. */
  | "unreadable"
  /**
   * Slack does not vouch for the user's email: deleted, a bot, a guest from another Slack team (Slack Connect), or an
   * email Slack has not confirmed.
   */
  | "unconfirmed"
  /** No verified member of the workspace has this email (or their role is not a Brigade role). */
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

/** What the workspace's shard answers for an action. */
export type SlackActOutcome =
  | { ok: true; did: "declared" | "acknowledged"; incident: SlackIncident }
  | {
      ok: false;
      code: SlackActRefusal;
      incident?: SlackIncident;
      /** Incident numbers to pick from (`ambiguous`), at most five. */
      choices?: number[];
    };

/** What the bridge answers: the outcome, and what the reply needs to word it. */
export type SlackActResult = SlackActOutcome & {
  /** The connected workspace's name; empty when there is none. */
  workspaceName: string;
  /** The member's own language, else Slack's for the user, else the connection's, else `en`. */
  locale: SlackLocale;
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

export type SlackInstallResult =
  | { ok: true }
  | {
      ok: false;
      code: SlackInstallRefusal;
      /**
       * Whether this Worker may give the token back (`auth.revoke`). Slack can hand a reinstall the same bot token a
       * workspace already holds, so the API says no unless it checked that no workspace holds this one.
       */
      revoke: boolean;
    };

/** The API's `SlackBridge` entrypoint, as this Worker calls it. */
export interface SlackBridgeApi {
  /** The language to answer `requester` in when no action runs (the usage): Slack's for them, else the connection's. */
  locale(requester: SlackRequester): Promise<SlackLocale>;
  /** Runs `incident.declare` or `incident.ack` as the member the Slack user's confirmed email maps to. */
  act(request: SlackActRequest): Promise<SlackActResult>;
  /** Finishes an install: takes the one-time state and connects the team as the member who started it. */
  completeInstall(state: string, install: SlackInstall): Promise<SlackInstallResult>;
}
