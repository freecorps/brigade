// The contract between this Worker and the API's `SlackBridge` entrypoint (apps/api src/slack-bridge.ts), RFC 0011
// "Shape". The API implements it; this Worker calls it through the `API` service binding. Every D1 read, every shard
// write and every Web API call that needs the bot token happen on the API's side, so this Worker holds no binding to
// either and never sees a token: it answers Slack through each request's `response_url`, which needs none.

import type { Severity, SlackLocale } from "@freecorps/brigade-schema";

/**
 * Which incident an action is about: `incidentId` from a button, `number` from `/inc … INC-12`, else the incident
 * whose channel `channelId` is (or whose message `threadTs` is, in the main channel), else the only active one.
 */
export type SlackTarget = {
  incidentId?: string;
  number?: number;
  channelId?: string;
  threadTs?: string;
};

/** What a Slack user asked for: `/inc` and its form, the Acknowledge button, `!update` and the message shortcut. */
export type SlackAction =
  | { kind: "declare"; title: string; severity: Severity; typeId?: string; serviceIds?: string[] }
  /** Without a target: the only incident waiting for an acknowledgement. */
  | ({ kind: "ack" } & SlackTarget)
  /**
   * `incident.postUpdate`. `fromMessage`: the text is a Slack message already in the channel (`!update`, the
   * shortcut), so the timeline mirror does not post it again, and only the incident's own channel or thread counts.
   */
  | ({ kind: "update"; body: string; fromMessage?: boolean } & SlackTarget)
  | ({ kind: "severity"; severity: Severity } & SlackTarget)
  | ({ kind: "resolve" } & SlackTarget)
  /** `role` as typed (a role's id or name); `user` the Slack user (`U…`) it goes to, mapped like the requester. */
  | ({ kind: "role"; role: string; user: string } & SlackTarget)
  /** Pages the escalation's next level now (`escalation.now`). */
  | ({ kind: "escalate" } & SlackTarget);

/** Who asked: a Slack user (`U…`/`W…`) of a Slack team (`T…`), as Slack's signed request named them. */
export type SlackRequester = { teamId: string; slackUserId: string };

export type SlackActRequest = SlackRequester & {
  action: SlackAction;
  /**
   * Names this request (a hash of the command's `trigger_id`, or of the click), so a replayed or repeated request
   * runs its mutation once and gets the same answer.
   */
  key: string;
  /**
   * Where to answer when the request has no `response_url` (an Events API message): the API posts the answer as an
   * ephemeral message to the user in that channel (and thread).
   */
  answer?: { channelId: string; threadTs?: string };
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
  | "invalid_update"
  /** Several incidents are active and the action named none: `choices` lists them. */
  | "which"
  /** No incident is active and the action named none. */
  | "no_active"
  /** Already so: the same severity, the same person in the role. */
  | "unchanged"
  /** `/inc escalate` on an incident with no escalation under way. */
  | "not_escalating"
  /** `/inc role` with a role the workspace does not have: `roles` lists the ones it does. */
  | "unknown_role"
  /** `/inc role` for a Slack user who maps to no member. */
  | "role_unmapped"
  /** `/inc role` for a viewer, who cannot hold incident roles. */
  | "role_viewer"
  /** `!update` or the shortcut outside an incident's channel or message thread. */
  | "not_incident_channel"
  /** Anything else: D1 or the shard down, a bug. Try again. */
  | "failed";

/** What an action that ran did. */
export type SlackDid =
  | "declared"
  | "acknowledged"
  | "updated"
  | "severity"
  | "resolved"
  | "role"
  | "escalated";

/** A role as replies name it: a built-in by its id (translated where the reply is worded), else the workspace's name. */
export type SlackRoleName = { id: string; name: string | null };

/** What the workspace's shard answers for an action. */
export type SlackActOutcome =
  | {
      ok: true;
      did: SlackDid;
      incident: SlackIncident;
      /** `severity`: the severity it has now. */
      severity?: Severity;
      /** `role`: the role given. */
      role?: SlackRoleName;
    }
  | {
      ok: false;
      code: SlackActRefusal;
      incident?: SlackIncident;
      /** Incident numbers to pick from (`ambiguous`, `which`), at most five. */
      choices?: number[];
      /** `unknown_role`: the roles the workspace has. */
      roles?: SlackRoleName[];
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

/** `/inc declare` alone: the form, opened with `views.open` while Slack's `trigger_id` is still good (3 s). */
export type SlackOpenDeclare = SlackRequester & {
  triggerId: string;
  /** What the form starts at (`/inc declare sev1`). */
  severity: Severity;
  /** Carried through the form so the submission can answer the person: the command's `response_url`. */
  responseUrl: string;
};

/** Whether the form opened; when not, the reply says why in `locale`. */
export type SlackOpenDeclareResult =
  | { ok: true }
  | { ok: false; code: SlackActRefusal; locale: SlackLocale; workspaceName: string };

/** Slack took the app's access away (Events API): `app_uninstalled`, or `tokens_revoked` for these bot users. */
export type SlackRevocation =
  | { teamId: string; reason: "uninstalled" }
  | { teamId: string; reason: "tokens_revoked"; botUserIds: string[] };

/** The API's `SlackBridge` entrypoint, as this Worker calls it. */
export interface SlackBridgeApi {
  /** The language to answer `requester` in when no action runs (the usage): Slack's for them, else the connection's. */
  locale(requester: SlackRequester): Promise<SlackLocale>;
  /** Runs an action as the member the Slack user's confirmed email maps to, through the shard's own mutations. */
  act(request: SlackActRequest): Promise<SlackActResult>;
  /** Opens the declare form for the Slack user, with the workspace's incident types and services. */
  openDeclare(request: SlackOpenDeclare): Promise<SlackOpenDeclareResult>;
  /** Marks the team's connection revoked: the token is forgotten and nothing more is sent. */
  revoked(revocation: SlackRevocation): Promise<void>;
  /** Finishes an install: takes the one-time state and connects the team as the member who started it. */
  completeInstall(state: string, install: SlackInstall): Promise<SlackInstallResult>;
}
