// Which client serves a workspace (RFC 0016 step 4): Ember's once the workspace switched, Brigade Sync otherwise.
import { expect, test } from "vite-plus/test";
import { probeWorkspaceEngine } from "../src/lib/sync";

const answer =
  (status: number, body: unknown = {}): typeof fetch =>
  async () =>
    Response.json(body, { status });

test("a token for the workspace means Ember", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push(`${init?.method} ${input as string}`);
    return Response.json({
      token: "jwt",
      expiresAt: Date.now() + 300_000,
      shard: "workspace:org_a",
    });
  };
  expect(await probeWorkspaceEngine("org_a", fetchImpl)).toBe("ember");
  expect(seen).toEqual(["POST /api/ember-token/org_a"]);
});

test("anything else is Brigade Sync, which the adapter serves for an Ember workspace too", async () => {
  // Still on WorkspaceDO, an instance from before Ember, signed out, not a member, a 5xx.
  for (const status of [409, 404, 401, 403, 503]) {
    expect(await probeWorkspaceEngine("org_a", answer(status))).toBe("brigade");
  }
  expect(await probeWorkspaceEngine("org_a", answer(200, { nope: true }))).toBe("brigade");
  const offline: typeof fetch = async () => {
    throw new TypeError("offline");
  };
  expect(await probeWorkspaceEngine("org_a", offline)).toBe("brigade");
});
