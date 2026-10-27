import { setLocale } from "@freecorps/brigade-i18n";
import { TOKEN_SCOPES } from "@freecorps/brigade-schema";
import { afterEach, expect, test } from "vite-plus/test";
import {
  checkTokenDraft,
  grantable,
  mintToken,
  revokeToken,
  SCOPE_GROUPS,
  scopeLabel,
} from "../src/lib/api-tokens";

afterEach(() => setLocale("en"));

const answer =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    Response.json(body, { status });

test("every scope is in one group, and each has its own label in both languages", async () => {
  expect(SCOPE_GROUPS.flatMap((group) => group.scopes)).toEqual(TOKEN_SCOPES);
  const labels = TOKEN_SCOPES.map(scopeLabel);
  expect(new Set(labels).size).toBe(TOKEN_SCOPES.length);
  await setLocale("pt-BR");
  expect(scopeLabel("incident:ack")).toBe("Reconhecer incidentes");
});

test("a token is offered only what its creator's role grants", () => {
  expect(grantable("admin")).toEqual(TOKEN_SCOPES);
  expect(grantable("responder")).not.toContain("monitor:manage");
  expect(grantable("viewer")).toContain("incident:read");
});

test("the form wants a name and a scope", () => {
  expect(checkTokenDraft({ name: " ", scopes: [], expiresInDays: 90 })).toEqual({
    name: "Give it a name of up to 60 characters.",
    scopes: "Pick at least one scope.",
  });
  expect(
    checkTokenDraft({ name: "x".repeat(61), scopes: ["incident:ack"], expiresInDays: null }),
  ).toHaveProperty("name");
  expect(checkTokenDraft({ name: "CI", scopes: ["incident:ack"], expiresInDays: 30 })).toEqual({});
});

test("minting answers the token once, or why not", async () => {
  const draft = { name: " CI ", scopes: ["incident:ack" as const], expiresInDays: 30 as const };
  let sent: unknown;
  const ok = await mintToken("ws_1", draft, async (_url, init) => {
    sent = JSON.parse(init?.body as string);
    return Response.json({ id: "tok_1", token: "brg_x", name: "CI" }, { status: 201 });
  });
  expect(ok).toEqual({ ok: true, token: "brg_x", name: "CI" });
  expect(sent).toEqual({ name: "CI", scopes: ["incident:ack"], expiresInDays: 30 });
  expect(await mintToken("ws_1", draft, answer(409, { error: "limit_reached" }))).toEqual({
    ok: false,
    part: "limit",
  });
  expect(await mintToken("ws_1", draft, answer(403, { error: "forbidden" }))).toEqual({
    ok: false,
    part: "forbidden",
  });
  expect(
    await mintToken("ws_1", draft, async () => {
      throw new TypeError("offline");
    }),
  ).toEqual({ ok: false, part: "create_failed" });
  expect(await revokeToken("ws_1", "tok_1", answer(200, { ok: true }))).toBe(true);
  expect(await revokeToken("ws_1", "tok_1", answer(503, { error: "unavailable" }))).toBe(false);
});
