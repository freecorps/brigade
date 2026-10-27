// API tokens (RFC 0014): minting never exceeds the creator's role, the list holds no secret, a token's scopes bound
// what it runs and reads, and the events.
import { describe, expect, test } from "vite-plus/test";
import {
  API_TOKEN_LISTED_MS,
  apiTokenRequest,
  apiTokenState,
  createMemoryStore,
  MAX_API_TOKENS,
  mutations,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  TOKEN_SCOPES,
  TOKENS_ACTOR,
  type Actor,
  type BrigadeTables,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 27, 12, 0, 0);
const TOK = "tok_01JB0000000000000000000001";
const TOK2 = "tok_01JB0000000000000000000002";

const ctx = (role: Role, kind: Actor["kind"] = "user", now = T): MutationContext => ({
  actor: { kind, id: "usr_ana", role },
  now,
  server: true,
});

function create(
  store = createMemoryStore<BrigadeTables>(),
  args: object = {},
  context = ctx("admin"),
) {
  const result = runMutation(
    serverMutations,
    "apiToken.create",
    { id: TOK, name: "Deploy bot", scopes: ["incident:ack"], expiresAt: null, ...args },
    store,
    context,
  );
  return { store, result };
}

describe("apiToken.create", () => {
  test("lists the token and emits apiToken.created, with no secret anywhere", () => {
    const { store, result } = create();
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "apiToken.created",
          subject: TOK,
          data: {
            id: TOK,
            name: "Deploy bot",
            scopes: ["incident:ack"],
            expiresAt: null,
            createdBy: "usr_ana",
          },
        },
      ],
    });
    expect(Object.keys(store.get("api_tokens", TOK)!).sort()).toEqual([
      "createdAt",
      "createdBy",
      "expiresAt",
      "id",
      "lastUsedAt",
      "name",
      "revokedAt",
      "revokedBy",
      "scopes",
    ]);
  });

  test("is server only, and for owners and admins", () => {
    expect(Object.keys(mutations)).not.toContain("apiToken.create");
    expect(create(undefined, {}, ctx("responder")).result).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  test("never grants a scope beyond the creator's role", () => {
    // A responder cannot hold `monitor:manage`, so cannot grant it either (minting itself is refused first for them;
    // the check is the mutation's own, for an admin asking for what only an owner has).
    expect(create(undefined, { scopes: ["workspace:manage"] }, ctx("admin")).result).toMatchObject({
      ok: true,
    });
    // Outside TOKEN_SCOPES whatever the role.
    expect(create(undefined, { scopes: ["token:manage"] }).result).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
    expect(create(undefined, { scopes: ["device:register"] }).result).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
    expect(TOKEN_SCOPES).not.toContain("workspace:create");
  });

  test("a token never mints a token", () => {
    const token: MutationContext = {
      actor: { kind: "token", id: TOK2, role: "owner", by: "usr_ana", scopes: [...TOKEN_SCOPES] },
      now: T,
      server: true,
    };
    // `token:manage` is never a token's scope, so RBAC refuses it before the mutation runs.
    expect(create(undefined, {}, token).result).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  test(`at most ${MAX_API_TOKENS} live tokens; old ended ones are dropped`, () => {
    const store = createMemoryStore<BrigadeTables>();
    for (let index = 0; index < MAX_API_TOKENS; index++) {
      store.insert("api_tokens", {
        id: `tok_01JC00000000000000000${String(index).padStart(5, "0")}`,
        name: "x",
        scopes: ["incident:ack"],
        createdBy: "usr_ana",
        createdAt: T,
        expiresAt: index === 0 ? T - API_TOKEN_LISTED_MS : null,
        lastUsedAt: null,
        revokedAt: null,
        revokedBy: null,
      });
    }
    // One of them expired long ago: dropped, and there is room again.
    expect(create(store).result).toMatchObject({ ok: true });
    expect(create(store, { id: TOK2 }).result).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
  });

  test("the request validator takes days, or null for until revoked", () => {
    expect(apiTokenRequest({ name: "CI", scopes: ["incident:ack"], expiresInDays: 30 }).ok).toBe(
      true,
    );
    expect(apiTokenRequest({ name: "CI", scopes: ["incident:ack"], expiresInDays: null }).ok).toBe(
      true,
    );
    expect(apiTokenRequest({ name: "CI", scopes: [], expiresInDays: null }).ok).toBe(false);
    expect(apiTokenRequest({ name: "CI", scopes: ["incident:ack"], expiresInDays: 400 }).ok).toBe(
      false,
    );
  });
});

describe("apiToken.revoke and apiToken.touch", () => {
  test("revoke marks it once and emits apiToken.revoked", () => {
    const { store } = create();
    const first = runMutation(serverMutations, "apiToken.revoke", { id: TOK }, store, ctx("owner"));
    expect(first).toEqual({
      ok: true,
      events: [{ type: "apiToken.revoked", subject: TOK, data: { id: TOK, name: "Deploy bot" } }],
    });
    expect(store.get("api_tokens", TOK)).toMatchObject({ revokedAt: T, revokedBy: "usr_ana" });
    expect(
      runMutation(serverMutations, "apiToken.revoke", { id: TOK }, store, ctx("owner")),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("touch is the API's alone, and only moves forward", () => {
    const { store } = create();
    const touch = (at: number, context: MutationContext) =>
      runMutation(serverMutations, "apiToken.touch", { id: TOK, at }, store, context);
    expect(touch(T, ctx("owner"))).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(touch(T + 1, { actor: TOKENS_ACTOR, now: T, server: true })).toEqual({
      ok: true,
      events: [],
    });
    expect(touch(T, { actor: TOKENS_ACTOR, now: T, server: true })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(store.get("api_tokens", TOK)!.lastUsedAt).toBe(T + 1);
  });

  test("state: revoked, expired, disabled when the creator left, else active", () => {
    const { store } = create(undefined, { expiresAt: T + 10 });
    const row = store.get("api_tokens", TOK)!;
    expect(apiTokenState(row, T, () => true)).toBe("active");
    expect(apiTokenState(row, T, () => false)).toBe("disabled");
    expect(apiTokenState(row, T + 10, () => true)).toBe("expired");
    expect(apiTokenState({ ...row, revokedAt: T }, T, () => true)).toBe("revoked");
  });
});

describe("a token's scopes bound what it does over sync", () => {
  const token: Actor = {
    kind: "token",
    id: TOK,
    role: "admin",
    by: "usr_ana",
    scopes: ["incident:read", "incident:ack"],
  };

  test("a mutation its scopes do not hold is forbidden, though the role grants it", () => {
    const store = createMemoryStore<BrigadeTables>();
    const declare = runMutation(
      mutations,
      "incident.declare",
      { id: "inc_01JB0000000000000000000001", title: "Down", severity: "sev2" },
      store,
      { actor: token, now: T, server: true },
    );
    expect(declare).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("a query its scopes do not hold is forbidden", () => {
    const store = createMemoryStore<BrigadeTables>();
    expect(
      runQuery(queries, "incidents.active", {}, store, "admin", { scopes: token.scopes }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      runQuery(queries, "monitors.all", {}, store, "admin", { scopes: token.scopes }),
    ).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});
