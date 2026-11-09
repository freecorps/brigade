// The dashboard's Ember tokens (RFC 0016 step 5): one per connect and refresh, none when signed out or not a member.
import { expect, test } from "vite-plus/test";
import { emberToken } from "../src/lib/sync";

const answer =
  (status: number, body: unknown = {}, seen: string[] = []): typeof fetch =>
  async (input, init) => {
    seen.push(`${init?.method} ${input as string}`);
    return Response.json(body, { status });
  };

test("a token for the workspace, asked with the page's session", async () => {
  const seen: string[] = [];
  const minted = { token: "jwt", expiresAt: Date.now() + 300_000, shard: "workspace:org_a" };
  expect(await emberToken("org_a", answer(200, minted, seen))).toBe("jwt");
  expect(seen).toEqual(["POST /api/ember-token/org_a"]);
});

test("signed out or not a member is no token; a 5xx or an answer without one fails, so the client asks again", async () => {
  expect(await emberToken("org_a", answer(401))).toBeNull();
  expect(await emberToken("org_a", answer(403))).toBeNull();
  await expect(emberToken("org_a", answer(503))).rejects.toThrow("Ember token: 503");
  await expect(emberToken("org_a", answer(200, { nope: true }))).rejects.toThrow("no token");
});
