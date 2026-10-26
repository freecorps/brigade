// The invitation email (RFC 0003 "Invitations", RFC 0005 "Email"), run by the `brigade-events` consumer
// (src/notify.ts) for `member.invited`: the workspace shard claims the email in its ledger (src/invitations.ts), this
// reads the invitation, the workspace and the people from D1, renders the email (src/email-templates.ts) in the
// invitee's language (their account's, if they have one, else the inviter's), sends it through the configured
// `EmailSender` (src/email.ts) and reports back. Nothing here is on the paging path.

import { resolveLocale } from "@freecorps/brigade-i18n";
import { isRole } from "@freecorps/brigade-schema";
import { dashboardLink, renderInvitationEmail } from "./email-templates.ts";
import { linkFallback, type EmailSender } from "./email.ts";
import { INVITATION_CLAIM_MS } from "./invitations.ts";
import { emailRetryDelay, MAX_EMAIL_ATTEMPTS, RECIPIENTS_TIMEOUT_MS } from "./notify-email.ts";
import type { BrigadeEvent } from "./outbox.ts";

export type InviteNotifyEnv = {
  WORKSPACE: Env["WORKSPACE"];
  DB?: D1Database;
  /**
   * The dashboard's origin for the link. Without it only the dev log sender uses the origin the invitation was made
   * through (`linkFallback`); a real sender sends nothing.
   */
  DASHBOARD_URL?: string;
};

/** Whether `event` asks for an invitation email. */
export function asksForInvitation(event: BrigadeEvent): boolean {
  return event.type === "member.invited";
}

type InvitationFacts = {
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
  workspace: string;
  inviter: string | null;
  inviterLocale: string | null;
  inviteeLocale: string | null;
};

/**
 * The invitation email for one `member.invited`. Returns the seconds to wait before trying again, or undefined when
 * it is done (sent, not needed any more, or given up after `MAX_EMAIL_ATTEMPTS`). Without a sender (email not set
 * up) it does nothing: the invitation stays pending, and the dashboard lists it. Throws only when the shard cannot
 * be reached.
 */
export async function notifyInvitation(
  event: BrigadeEvent,
  attempts: number,
  env: InviteNotifyEnv,
  sender: EmailSender | undefined,
): Promise<number | undefined> {
  if (!sender) return undefined;
  const workspace = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await workspace.planInvitationEmail(event);
  if (!plan.send) {
    return plan.reason === "held"
      ? Math.max(
          emailRetryDelay(attempts),
          Math.ceil(Math.max(INVITATION_CLAIM_MS, plan.until - Date.now()) / 1000),
        )
      : undefined;
  }
  const last = attempts >= MAX_EMAIL_ATTEMPTS;
  const invitationId = event.subject ?? "";
  let facts: InvitationFacts | null;
  try {
    facts = await read(env.DB, event.workspaceId, invitationId);
  } catch (error) {
    log("invitation email: D1 could not be read", { event: event.id, error: String(error) });
    await workspace.recordInvitationEmail(event, plan.key, last);
    return last ? undefined : emailRetryDelay(attempts);
  }
  // Accepted, declined, revoked or run out meanwhile: nothing to send.
  if (
    !facts ||
    facts.status !== "pending" ||
    Date.parse(facts.expiresAt) <= Date.now() ||
    !isRole(facts.role)
  ) {
    await workspace.recordInvitationEmail(event, plan.key, true);
    return undefined;
  }
  const link = dashboardLink(
    `/invitations/${invitationId}`,
    {},
    env.DASHBOARD_URL,
    linkFallback(sender, plan.origin),
  );
  if (!link) {
    log("invitation email not sent: DASHBOARD_URL is not set", { event: event.id });
    await workspace.recordInvitationEmail(event, plan.key, true);
    return undefined;
  }
  const locale = resolveLocale(facts.inviteeLocale ?? facts.inviterLocale ?? undefined);
  const result = await sender.send(
    renderInvitationEmail(
      { inviter: facts.inviter ?? "Brigade", workspace: facts.workspace, role: facts.role },
      { email: facts.email },
      link,
      locale,
    ),
  );
  if (result.ok) {
    await workspace.recordInvitationEmail(event, plan.key, true);
    return undefined;
  }
  // Never the address.
  log("invitation email refused", {
    event: event.id,
    sender: sender.id,
    code: result.code,
    retry: result.retry,
  });
  const done = !result.retry || last;
  await workspace.recordInvitationEmail(event, plan.key, done);
  return done ? undefined : emailRetryDelay(attempts);
}

/**
 * The invitation, its workspace and its inviter, and the invitee's language if they have an account: both addresses
 * are stored lower-cased (Better Auth's `user`, `invitationEmail`), so they compare as they are, on `user`'s index.
 */
async function read(
  db: D1Database | undefined,
  workspaceId: string,
  invitationId: string,
): Promise<InvitationFacts | null> {
  if (!db) throw new Error("no D1 binding");
  const query = db
    .prepare(
      `select i.email, i.role, i.status, i."expiresAt" as expiresAt, o.name as workspace,
              u.name as inviter, u.locale as inviterLocale,
              (select locale from "user" where email = i.email) as inviteeLocale
       from invitation i join organization o on o.id = i."organizationId"
       left join "user" u on u.id = i."inviterId"
       where i.id = ? and i."organizationId" = ?`,
    )
    .bind(invitationId, workspaceId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      query.first<InvitationFacts>(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("D1 timed out")), RECIPIENTS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "email", ...fields }));
}
