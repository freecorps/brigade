// A member's own email choices and time zone (RFC 0005 "Email") and reminders of follow-ups due (RFC 0013
// "Reminders"): who may set them, when a member's reminder is due on their own clock, and at most one a day.
import { describe, expect, test } from "vite-plus/test";
import {
  ACCOUNT_ACTOR,
  createMemoryStore,
  DEFAULT_MEMBER_EMAIL,
  localDate,
  memberEmailOf,
  mutations,
  nextReminderAt,
  REMINDER_HOUR,
  REMINDERS_PER_RUN,
  remindersDue,
  runMutation,
  serverMutations,
  type Actor,
  type BrigadeTables,
  type MutationStore,
} from "../src/index.ts";

// 2026-10-27, 08:30 UTC: half an hour before the reminder hour in UTC, 05:30 in São Paulo, 17:30 in Tokyo.
const T = Date.UTC(2026, 9, 27, 8, 30, 0);
const HOUR = 60 * 60 * 1000;
const INC = "inc_01JB0000000000000000000001";
const fup = (n: number) => `fup_01JB00000000000000000000${String(n).padStart(2, "0")}`;

const ana: Actor = { kind: "user", id: "usr_ana", role: "owner" };
const caio: Actor = { kind: "user", id: "usr_caio", role: "responder" };
const duda: Actor = { kind: "user", id: "usr_duda", role: "viewer" };
const token: Actor = { kind: "token", id: "usr_ana", role: "owner", scopes: ["device:register"] };

const run = (store: MutationStore, actor: Actor, name: string, args: unknown, now = T) =>
  runMutation(mutations, name, args, store, { actor, now, server: true });
const server = (store: MutationStore, name: string, args: unknown, now = T) =>
  runMutation(serverMutations, name, args, store, { actor: ACCOUNT_ACTOR, now, server: true });

function shard() {
  const store = createMemoryStore<BrigadeTables>();
  for (const actor of [ana, caio, duda]) {
    store.insert("members", {
      id: actor.id,
      name: actor.id.slice(4),
      role: actor.role,
      updatedAt: 0,
    });
  }
  store.insert("workspace", { id: "ws_x", name: "Acme", createdAt: 0, createdBy: ana.id });
  run(store, ana, "incident.declare", { id: INC, title: "Checkout down", severity: "sev1" });
  return store;
}

function addFollowUp(
  store: MutationStore,
  n: number,
  ownerId: string | null,
  dueDate: string | null,
) {
  expect(
    run(store, ana, "followUp.create", {
      id: fup(n),
      incidentId: INC,
      title: `Follow-up ${n}`,
      ownerId,
      dueDate,
      link: null,
    }),
  ).toMatchObject({ ok: true });
}

describe("member.setEmail", () => {
  test("every role sets their own; both default on; the same again is a conflict; a token never sets it", () => {
    const store = shard();
    expect(memberEmailOf(store.scan("member_settings"), caio.id)).toEqual(DEFAULT_MEMBER_EMAIL);
    expect(DEFAULT_MEMBER_EMAIL).toEqual({ missedPages: true, followUpReminders: true });
    expect(
      run(store, duda, "member.setEmail", { missedPages: false, followUpReminders: true }),
    ).toMatchObject({ ok: true });
    expect(
      run(store, caio, "member.setEmail", { missedPages: false, followUpReminders: false }),
    ).toEqual({
      ok: true,
      events: [
        {
          type: "member.email_changed",
          subject: caio.id,
          data: { userId: caio.id, missedPages: false, followUpReminders: false },
        },
      ],
    });
    // The row keeps the default call choice: setting email never changes calls.
    expect(store.get("member_settings", caio.id)).toMatchObject({
      calls: "sev1_sev2",
      missedPageEmail: false,
      followUpReminders: false,
    });
    expect(
      run(store, caio, "member.setEmail", { missedPages: false, followUpReminders: false }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      run(store, token, "member.setEmail", { missedPages: false, followUpReminders: true }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(run(store, caio, "member.setEmail", { missedPages: false })).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
  });

  test("setting calls afterwards keeps the email choices", () => {
    const store = shard();
    run(store, caio, "member.setEmail", { missedPages: false, followUpReminders: true });
    expect(run(store, caio, "member.setCalls", { calls: "never" })).toMatchObject({ ok: true });
    expect(memberEmailOf(store.scan("member_settings"), caio.id)).toEqual({
      missedPages: false,
      followUpReminders: true,
    });
  });
});

describe("member.setTimeZone", () => {
  test("keeps the runtime's spelling; refuses what is not a zone, a token, and no change", () => {
    const store = shard();
    expect(run(store, caio, "member.setTimeZone", { timeZone: "america/sao_paulo" })).toEqual({
      ok: true,
      events: [
        {
          type: "member.time_zone_changed",
          subject: caio.id,
          data: { userId: caio.id, timeZone: "America/Sao_Paulo" },
        },
      ],
    });
    expect(run(store, caio, "member.setTimeZone", { timeZone: "America/Sao_Paulo" })).toMatchObject(
      { ok: false, error: { code: "conflict" } },
    );
    expect(run(store, caio, "member.setTimeZone", { timeZone: "Mars/Olympus" })).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
    expect(run(store, token, "member.setTimeZone", { timeZone: "Asia/Tokyo" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});

describe("reminders of follow-ups due", () => {
  test("at 09:00 on the owner's clock, for what is due that day or overdue; UTC without a time zone", () => {
    const store = shard();
    addFollowUp(store, 1, caio.id, "2026-10-27");
    addFollowUp(store, 2, caio.id, "2026-10-20");
    // Not due yet, without a date, done, or nobody's: none of them asks for a reminder.
    addFollowUp(store, 3, ana.id, "2026-10-30");
    addFollowUp(store, 4, ana.id, null);
    addFollowUp(store, 5, null, "2026-10-01");
    // UTC: 08:30, half an hour early.
    expect(remindersDue(store, T)).toEqual([]);
    expect(nextReminderAt(store, T)).toBe(Date.UTC(2026, 9, 27, REMINDER_HOUR));
    expect(remindersDue(store, T + HOUR)).toEqual([{ userId: caio.id, date: "2026-10-27" }]);
    // In Tokyo it is 17:30 on the 27th: due now.
    run(store, caio, "member.setTimeZone", { timeZone: "Asia/Tokyo" });
    expect(remindersDue(store, T)).toEqual([{ userId: caio.id, date: "2026-10-27" }]);
    // In São Paulo it is 05:30: 09:00 there is 12:00 UTC.
    run(store, caio, "member.setTimeZone", { timeZone: "America/Sao_Paulo" });
    expect(remindersDue(store, T)).toEqual([]);
    expect(nextReminderAt(store, T)).toBe(Date.UTC(2026, 9, 27, 12));
    // Ana's first is due on the 30th, at 09:00 UTC.
    run(store, caio, "member.setEmail", { missedPages: true, followUpReminders: false });
    expect(nextReminderAt(store, T)).toBe(Date.UTC(2026, 9, 30, REMINDER_HOUR));
  });

  test("once per member and day: the ledger moves the next to tomorrow", () => {
    const store = shard();
    addFollowUp(store, 1, caio.id, "2026-10-20");
    const at = T + HOUR;
    expect(server(store, "followUp.remind", { userId: caio.id, date: "2026-10-27" }, at)).toEqual({
      ok: true,
      events: [
        {
          type: "follow_up.reminder_due",
          subject: caio.id,
          data: { userId: caio.id, date: "2026-10-27", count: 1 },
        },
      ],
    });
    expect(remindersDue(store, at)).toEqual([]);
    expect(nextReminderAt(store, at)).toBe(Date.UTC(2026, 9, 28, REMINDER_HOUR));
    expect(
      server(store, "followUp.remind", { userId: caio.id, date: "2026-10-27" }, at),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    // The next day, again.
    const tomorrow = Date.UTC(2026, 9, 28, 10);
    expect(remindersDue(store, tomorrow)).toEqual([{ userId: caio.id, date: "2026-10-28" }]);
  });

  test("nothing for a member who turned reminders off, for nothing due, or from anyone but Brigade", () => {
    const store = shard();
    addFollowUp(store, 1, caio.id, "2026-10-20");
    const at = T + HOUR;
    run(store, caio, "member.setEmail", { missedPages: true, followUpReminders: false });
    expect(remindersDue(store, at)).toEqual([]);
    expect(nextReminderAt(store, at)).toBeNull();
    expect(
      server(store, "followUp.remind", { userId: caio.id, date: "2026-10-27" }, at),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    run(store, caio, "member.setEmail", { missedPages: true, followUpReminders: true });
    run(store, ana, "followUp.setStatus", { id: fup(1), status: "done" });
    expect(remindersDue(store, at)).toEqual([]);
    expect(
      server(store, "followUp.remind", { userId: caio.id, date: "2026-10-27" }, at),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    // A client never runs it: it is not in the clients' registry, and a member is refused anyway.
    expect(
      runMutation(mutations, "followUp.remind", { userId: caio.id, date: "2026-10-27" }, store, {
        actor: ana,
        now: at,
        server: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      runMutation(
        serverMutations,
        "followUp.remind",
        { userId: caio.id, date: "2026-10-27" },
        store,
        { actor: ana, now: at, server: true },
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("a time zone the runtime no longer knows falls back on UTC", () => {
    const store = shard();
    addFollowUp(store, 1, caio.id, "2026-10-20");
    store.insert("member_settings", {
      id: caio.id,
      calls: "sev1_sev2",
      timeZone: "Gone/Zone",
      updatedAt: 0,
    });
    expect(nextReminderAt(store, T)).toBe(Date.UTC(2026, 9, 27, REMINDER_HOUR));
    expect(localDate(T, "Asia/Tokyo")).toBe("2026-10-27");
  });

  test("a member removed from the workspace is not reminded of what they still own", () => {
    const store = shard();
    addFollowUp(store, 1, caio.id, "2026-10-20");
    const at = T + HOUR;
    expect(remindersDue(store, at)).toEqual([{ userId: caio.id, date: "2026-10-27" }]);
    store.delete("members", caio.id);
    expect(remindersDue(store, at)).toEqual([]);
    expect(nextReminderAt(store, at)).toBeNull();
    expect(
      server(store, "followUp.remind", { userId: caio.id, date: "2026-10-27" }, at),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("one run reminds at most REMINDERS_PER_RUN members, the longest due first; the next run takes the rest", () => {
    const store = shard();
    const extra = REMINDERS_PER_RUN + 5;
    // Straight into the store: more than one incident takes through `followUp.create`.
    const owe = (n: number, ownerId: string) =>
      store.insert("follow_ups", {
        id: `fup_m${n}`,
        incidentId: INC,
        incidentNumber: 1,
        incidentTitle: "Checkout down",
        title: `Follow-up ${n}`,
        ownerId,
        dueDate: "2026-10-20",
        link: null,
        status: "open",
        createdAt: 0,
        createdBy: ana.id,
        doneAt: null,
        doneBy: null,
        updatedAt: 0,
      });
    for (let n = 0; n < extra; n++) {
      const id = `usr_m${String(n).padStart(3, "0")}`;
      store.insert("members", { id, name: id, role: "responder", updatedAt: 0 });
      owe(n, id);
    }
    // Tokyo's 09:00 came first: Ana is due before everyone on UTC.
    owe(extra, ana.id);
    run(store, ana, "member.setTimeZone", { timeZone: "Asia/Tokyo" });
    const at = T + HOUR;
    const first = remindersDue(store, at);
    expect(first).toHaveLength(REMINDERS_PER_RUN);
    expect(first[0]).toEqual({ userId: ana.id, date: "2026-10-27" });
    for (const reminder of first) {
      expect(server(store, "followUp.remind", reminder, at)).toMatchObject({ ok: true });
    }
    const rest = remindersDue(store, at);
    expect(rest).toHaveLength(extra + 1 - REMINDERS_PER_RUN);
    expect(rest.filter((one) => first.some((done) => done.userId === one.userId))).toEqual([]);
    expect(nextReminderAt(store, at)).toBeLessThanOrEqual(at);
  });
});
