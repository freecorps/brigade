// Each member's choice of which pages ring their phones as a call (RFC 0010 "Who a call rings"). The alert push is
// sent either way: the choice only takes the call (step 2 of the ladder) away, never the page. Synced to every member,
// so "why wasn't I paged?" can say a member turned calls off; only the member sets their own.

import type { Severity } from "./lifecycle.ts";
import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { MemberSettingsRow } from "./tables.ts";
import { v } from "./validate.ts";

/**
 * Which pages ring as a call, of those that ring at all (a SEV1 page, or an escalation level of a SEV1 or SEV2 nobody
 * acknowledged, `ringsAsCall` in the API):
 * - `sev1_sev2`: all of them, the default;
 * - `sev1`: a SEV1's pages only, not a SEV2's escalation levels;
 * - `never`: none; every page is an alert push only.
 */
export const CALL_CHOICES = ["sev1_sev2", "sev1", "never"] as const;
export type CallChoice = (typeof CALL_CHOICES)[number];

/** What a member who never chose gets: every page that rings. */
export const DEFAULT_CALL_CHOICE: CallChoice = "sev1_sev2";

/** A member's choice, from the workspace's settings rows: the default without one. */
export function callChoiceOf(
  rows: readonly Pick<MemberSettingsRow, "id" | "calls">[],
  userId: string,
): CallChoice {
  return rows.find((row) => row.id === userId)?.calls ?? DEFAULT_CALL_CHOICE;
}

/**
 * Whether a page that rings (`ringsAsCall`) rings for a member with `choice`. Never decides that a page rings: it only
 * keeps a call from members who do not want it.
 */
export function wantsCall(choice: CallChoice | undefined, severity: Severity): boolean {
  switch (choice ?? DEFAULT_CALL_CHOICE) {
    case "sev1_sev2":
      return true;
    case "sev1":
      return severity === "sev1";
    case "never":
      return false;
  }
}

export type MemberCallsChanged = DomainEvent<
  "member.calls_changed",
  { userId: string; calls: CallChoice }
>;

/**
 * Sets which pages ring the actor's phones as a call. A member sets only their own: there is no member id to name, and
 * an API token (a script) never sets it. The same choice again is a `conflict`.
 */
export const setCalls = defineMutation({
  name: "member.setCalls",
  args: v.object({ calls: v.picklist(CALL_CHOICES) }),
  // Every role: whoever can register a phone to be paged on decides whether it rings.
  permission: "device:register",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "user") return fail("forbidden", "Only a member sets their own calls");
    const userId = ctx.actor.id;
    const current = store.get("member_settings", userId);
    if (current?.calls === args.calls) return fail("conflict", "Calls are unchanged");
    if (current) store.update("member_settings", userId, { calls: args.calls, updatedAt: ctx.now });
    else store.insert("member_settings", { id: userId, calls: args.calls, updatedAt: ctx.now });
    const event: MemberCallsChanged = {
      type: "member.calls_changed",
      subject: userId,
      data: { userId, calls: args.calls },
    };
    return ok(event);
  },
});

/** Forgets a member's settings when they leave the workspace. */
export function forgetMemberSettings(store: MutationStore, userId: string): void {
  if (store.get("member_settings", userId)) store.delete("member_settings", userId);
}

/** Every member's paging settings (only those who chose something have a row). */
export const allMemberSettings = defineQuery({
  name: "members.settings",
  args: v.object({}),
  permission: "workspace:read",
  table: "member_settings",
  filter: () => true,
});
