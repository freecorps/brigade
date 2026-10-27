// Each member's own email choices (RFC 0005 "Email", RFC 0013 "Reminders") and the time zone their reminders follow,
// kept on their `member_settings` row next to their call choice (calls.ts). Only the member sets their own; an API
// token never does. The owners' "a page reached nobody" email is not here: it is the fallback when paging fails, so
// only the workspace's setting (`workspace.setEmail`) turns it off.

import { DEFAULT_CALL_CHOICE } from "./calls.ts";
import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import type { MemberSettingsRow } from "./tables.ts";
import { v, type Validator } from "./validate.ts";
import { canonicalTimeZone } from "./zoned.ts";

/**
 * A member's own email choices:
 * - `missedPages`: the email when a SEV1 or SEV2 page missed them (the workspace's `unpaged` must be on too);
 * - `followUpReminders`: the daily email listing their open follow-ups due today or overdue.
 */
export type MemberEmail = { missedPages: boolean; followUpReminders: boolean };

/** What a member who never chose gets: both on. */
export const DEFAULT_MEMBER_EMAIL: MemberEmail = { missedPages: true, followUpReminders: true };

/** A member's email choices, from the workspace's settings rows: the defaults without one. */
export function memberEmailOf(
  rows: readonly Pick<MemberSettingsRow, "id" | "missedPageEmail" | "followUpReminders">[],
  userId: string,
): MemberEmail {
  const row = rows.find((one) => one.id === userId);
  return {
    missedPages: row?.missedPageEmail ?? DEFAULT_MEMBER_EMAIL.missedPages,
    followUpReminders: row?.followUpReminders ?? DEFAULT_MEMBER_EMAIL.followUpReminders,
  };
}

export type MemberEmailChanged = DomainEvent<
  "member.email_changed",
  { userId: string } & MemberEmail
>;

export type MemberTimeZoneChanged = DomainEvent<
  "member.time_zone_changed",
  { userId: string; timeZone: string }
>;

/** Writes `patch` on the actor's settings row, making it (with the default call choice) when there is none. */
function writeSettings(
  store: MutationStore,
  userId: string,
  patch: Partial<Omit<MemberSettingsRow, "id">>,
  now: number,
): void {
  if (store.get("member_settings", userId)) {
    store.update("member_settings", userId, { ...patch, updatedAt: now });
  } else {
    store.insert("member_settings", {
      id: userId,
      calls: DEFAULT_CALL_CHOICE,
      ...patch,
      updatedAt: now,
    });
  }
}

/**
 * Sets which emails the actor gets in this workspace (`MemberEmail`, both given). A member sets only their own, like
 * their calls (`member.setCalls`): there is no member id to name, and an API token never sets it. No change is a
 * `conflict`.
 */
export const setMemberEmail = defineMutation({
  name: "member.setEmail",
  args: v.object({ missedPages: v.boolean(), followUpReminders: v.boolean() }),
  // Every role: whoever can be paged decides what they are emailed about it.
  permission: "device:register",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "user") return fail("forbidden", "Only a member sets their own email");
    const userId = ctx.actor.id;
    const current = memberEmailOf(store.scan("member_settings"), userId);
    if (
      current.missedPages === args.missedPages &&
      current.followUpReminders === args.followUpReminders
    ) {
      return fail("conflict", "Email choices are unchanged");
    }
    writeSettings(
      store,
      userId,
      { missedPageEmail: args.missedPages, followUpReminders: args.followUpReminders },
      ctx.now,
    );
    const event: MemberEmailChanged = {
      type: "member.email_changed",
      subject: userId,
      data: {
        userId,
        missedPages: args.missedPages,
        followUpReminders: args.followUpReminders,
      },
    };
    return ok(event);
  },
});

/** An IANA time zone the runtime knows, in its own spelling ("america/sao_paulo" is "America/Sao_Paulo"). */
const timeZone: Validator<string> = (input, path = "") => {
  const canonical =
    typeof input === "string" && input.length <= 64 ? canonicalTimeZone(input) : undefined;
  return canonical === undefined
    ? { ok: false, issues: [{ path, message: "Expected an IANA time zone" }] }
    : { ok: true, value: canonical };
};

/**
 * Sets the time zone the actor's reminders follow (RFC 0013 "Reminders"): the dashboard and the app send the device's
 * own when it differs from the one kept, so nobody picks it by hand. Only the member's own; no change is a `conflict`.
 */
export const setMemberTimeZone = defineMutation({
  name: "member.setTimeZone",
  args: v.object({ timeZone }),
  permission: "device:register",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "user")
      return fail("forbidden", "Only a member sets their own time zone");
    const userId = ctx.actor.id;
    if (store.get("member_settings", userId)?.timeZone === args.timeZone) {
      return fail("conflict", "Time zone is unchanged");
    }
    writeSettings(store, userId, { timeZone: args.timeZone }, ctx.now);
    const event: MemberTimeZoneChanged = {
      type: "member.time_zone_changed",
      subject: userId,
      data: { userId, timeZone: args.timeZone },
    };
    return ok(event);
  },
});

export const memberEmailMutations = [setMemberEmail, setMemberTimeZone] as const;
