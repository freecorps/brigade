// Who a Slack user is (RFC 0011 "Who a Slack user is"): `users.info`, as the API's bridge calls it. Only the
// connected team's own users with an email Slack confirmed map to anyone.
import { afterEach, describe, expect, test } from "vite-plus/test";
import { clearPeople, lookUpPerson, PERSON_CACHE_MS } from "../src/people.ts";
import { BOT_TOKEN, fakeSlack, NOW, TEAM, USER } from "./fakes.ts";

afterEach(() => clearPeople());

const person = (user: Record<string, unknown>) => ({
  id: USER,
  team_id: TEAM,
  deleted: false,
  is_bot: false,
  is_email_confirmed: true,
  profile: { email: "ana@example.com" },
  ...user,
});

describe("lookUpPerson", () => {
  test("a confirmed email of the team's own user, lowercased, with their language", async () => {
    const slack = fakeSlack({
      user: person({ locale: "pt-BR", profile: { email: " Ana@Example.com " } }),
    });
    expect(await lookUpPerson(TEAM, USER, BOT_TOKEN, slack.fetch, NOW)).toEqual({
      ok: true,
      email: "ana@example.com",
      locale: "pt-BR",
    });
    // As a form: Slack ignores a JSON body on `users.info` and would answer `user_not_found`.
    expect(slack.calls.find((call) => call.url.endsWith("/users.info"))).toMatchObject({
      auth: `Bearer ${BOT_TOKEN}`,
      body: { user: USER, include_locale: "true" },
    });
  });

  test("unconfirmed emails, bots, deactivated users and no email map to nobody", async () => {
    for (const user of [
      { is_email_confirmed: false },
      { is_bot: true },
      { deleted: true },
      { profile: {} },
    ]) {
      clearPeople();
      const slack = fakeSlack({ user: person(user) });
      expect(
        await lookUpPerson(TEAM, USER, BOT_TOKEN, slack.fetch, NOW),
        JSON.stringify(user),
      ).toMatchObject({ ok: false, reason: "unconfirmed" });
    }
  });

  test("a guest from another Slack team (Slack Connect) maps to nobody, whatever their email", async () => {
    for (const user of [
      { team_id: "T0OTHER0001" },
      { is_stranger: true },
      { team_id: undefined },
    ]) {
      clearPeople();
      const slack = fakeSlack({ user: person(user) });
      expect(
        await lookUpPerson(TEAM, USER, BOT_TOKEN, slack.fetch, NOW),
        JSON.stringify(user),
      ).toMatchObject({ ok: false, reason: "unconfirmed" });
    }
  });

  test("kept for a few minutes per team and user, so a burst of commands is one call", async () => {
    const slack = fakeSlack({ user: person({}) });
    await lookUpPerson(TEAM, USER, BOT_TOKEN, slack.fetch, NOW);
    await lookUpPerson(TEAM, USER, BOT_TOKEN, slack.fetch, NOW + PERSON_CACHE_MS - 1);
    expect(slack.to("users.info")).toHaveLength(1);
    await lookUpPerson(TEAM, USER, BOT_TOKEN, slack.fetch, NOW + PERSON_CACHE_MS);
    expect(slack.to("users.info")).toHaveLength(2);
  });

  test("Slack failing is not cached", async () => {
    const slack = fakeSlack({
      methods: { "users.info": () => Response.json({ ok: false, error: "internal_error" }) },
    });
    expect(await lookUpPerson(TEAM, USER, BOT_TOKEN, slack.fetch, NOW)).toEqual({
      ok: false,
      reason: "failed",
      locale: null,
    });
    await lookUpPerson(TEAM, USER, BOT_TOKEN, slack.fetch, NOW);
    expect(slack.to("users.info")).toHaveLength(2);
  });
});
