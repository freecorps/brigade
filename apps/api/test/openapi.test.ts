// The API reference (src/openapi.ts, RFC 0002 "Public HTTP API") against the Worker: the committed
// docs/api/openapi.json is what the generator writes; every documented path answers exactly its documented methods;
// every operation answers its documented success, with a body its schema accepts, for a basic case; every session
// operation answers 401 without one; and every operation marked `bearerAuth` answers the same success with an API
// token instead of the cookie (RFC 0014), and 401 with a wrong one.
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import {
  alertSourceToken,
  checkJsonSchema,
  heartbeatToken,
  INVITATION_RESEND_INTERVAL_MS,
  newHeartbeatSecret,
  newId,
  TOKEN_SCOPES,
  WEBHOOK_PAYLOADS,
  type Actor,
  type JsonSchema,
} from "@freecorps/brigade-schema";
import { TOKEN } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test } from "vite-plus/test";
import committed from "../../../docs/api/openapi.json?raw";
import {
  IDEMPOTENCY_KEY_PATTERN,
  OPERATIONS,
  openApiDocument,
  openApiJson,
  responseSchema,
  WORKSPACE_ID_PATTERN,
  type Operation,
} from "../src/openapi.ts";
import { forgetAllTokens, newApiToken, tokenDigest } from "../src/api-tokens.ts";
import { Shard } from "../src/shard.ts";
import { serverSignedFixture } from "./sdk-fixture.ts";
import { IDEMPOTENCY_KEY_HEADER, ORGANIZATION_ID, type WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const document = openApiDocument();

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.close(1000, "done");
});

let people = 0;
let clients = 0;
/** A new client IP (TEST-NET-2) per call: sign-up is rate-limited per IP. */
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 3}`;

type Init = { method?: string; body?: string; headers?: Record<string, string> };

const api = (path: string, init: Init = {}) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  });

type Person = { id: string; cookie: string; email: string };

const address = (name: string) => `${name.toLowerCase()}-o${++people}@example.com`;

async function signUp(name: string, email = address(name)): Promise<Person> {
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = await sessionCookie(email, PASSWORD);
  await env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`)
    .bind(body.user.id)
    .run();
  return { id: body.user.id, cookie, email };
}

/** Ana owns a new workspace, Caio is its responder. */
async function team() {
  const [ana, caio] = await Promise.all([signUp("Ana"), signUp("Caio")]);
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: ana!.cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), id, caio!.id, "responder", new Date().toISOString())
    .run();
  const stub = env.WORKSPACE.getByName(id);
  const run = (name: string, args: unknown) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) => {
      const shard = new Shard(state.storage, {
        shard: "workspace",
        randomBytes: random,
        log: () => {},
      });
      const actor: Actor = { kind: "user", id: ana!.id, role: "owner" };
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: newId("mut", Date.now(), random),
        actor,
        name,
        args,
        now: Date.now(),
        internal: false,
      });
      expect(result, name).toMatchObject({ ok: true });
    });
  return { id, stub, ana: ana!, caio: caio!, run };
}

type Team = Awaited<ReturnType<typeof team>>;

/** Invites a new address as a responder; answers the invitation's id and the address. */
async function invite(t: Team) {
  const email = address("Guest");
  const response = await api(`/workspaces/${t.id}/invitations`, {
    method: "POST",
    headers: { Cookie: t.ana.cookie },
    body: JSON.stringify({ email, role: "responder" }),
  });
  expect(response.status).toBe(201);
  return { id: ((await response.json()) as { invitation: { id: string } }).invitation.id, email };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One request for an operation: its path filled in, and who sends it. */
type Case = { path: string; init?: Init; cookie?: string; status: number };

/** A basic case per operation, by `operationId`: what it takes to get its documented success. */
const CASES: Record<string, () => Promise<Case>> = {
  getHealth: async () => ({ path: "/health", status: 200 }),
  getPagingHealth: async () => {
    const t = await team();
    return { path: "/health/paging", cookie: t.ana.cookie, status: 200 };
  },
  pingHeartbeat: async () => {
    const t = await team();
    const monitorId = newId("mon", Date.now(), random);
    const secret = newHeartbeatSecret(random);
    await t.run("monitor.createHeartbeat", {
      id: monitorId,
      name: "Nightly backup",
      intervalSeconds: 60,
      graceSeconds: 30,
      tokenHash: await sha256Hex(secret),
    });
    return {
      path: `/heartbeat/${heartbeatToken(t.id, monitorId, secret)}`,
      init: { method: "POST" },
      status: 202,
    };
  },
  sendAlerts: async () => {
    const t = await team();
    const sourceId = newId("src", Date.now(), random);
    const secret = newHeartbeatSecret(random);
    await t.run("alertSource.create", {
      id: sourceId,
      name: "Generic",
      kind: "generic",
      tokenHash: await sha256Hex(secret),
      auth: null,
      signingSecret: null,
    });
    return {
      path: `/alerts/${alertSourceToken(t.id, sourceId, secret)}`,
      init: { method: "POST", body: JSON.stringify({ title: "Disk almost full on web-1" }) },
      status: 202,
    };
  },
  createWorkspace: async () => {
    const owner = await signUp("Olga");
    return {
      path: "/workspaces",
      init: { method: "POST", body: JSON.stringify({ name: "Northwind" }) },
      cookie: owner.cookie,
      status: 201,
    };
  },
  changeMemberRole: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/members/${t.caio.id}`,
      init: { method: "PATCH", body: JSON.stringify({ role: "viewer" }) },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  removeMember: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/members/${t.caio.id}`,
      init: { method: "DELETE" },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  listInvitations: async () => {
    const t = await team();
    await invite(t);
    return { path: `/workspaces/${t.id}/invitations`, cookie: t.ana.cookie, status: 200 };
  },
  invite: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/invitations`,
      init: { method: "POST", body: JSON.stringify({ email: address("New"), role: "viewer" }) },
      cookie: t.ana.cookie,
      status: 201,
    };
  },
  revokeInvitation: async () => {
    const t = await team();
    const { id } = await invite(t);
    return {
      path: `/workspaces/${t.id}/invitations/${id}`,
      init: { method: "DELETE" },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  resendInvitation: async () => {
    const t = await team();
    const { id } = await invite(t);
    // Sent just now: as if it went out long enough ago to be sent again.
    await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      state.storage.sql.exec(
        "update invitation_sends set at = ? where invitation_id = ?",
        Date.now() - INVITATION_RESEND_INTERVAL_MS - 1,
        id,
      ),
    );
    return {
      path: `/workspaces/${t.id}/invitations/${id}/resend`,
      init: { method: "POST" },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  getInvitation: async () => {
    const t = await team();
    const { id, email } = await invite(t);
    const guest = await signUp("Guest", email);
    return { path: `/invitations/${id}`, cookie: guest.cookie, status: 200 };
  },
  acceptInvitation: async () => {
    const t = await team();
    const { id, email } = await invite(t);
    const guest = await signUp("Guest", email);
    return {
      path: `/invitations/${id}/accept`,
      init: { method: "POST" },
      cookie: guest.cookie,
      status: 200,
    };
  },
  declineInvitation: async () => {
    const t = await team();
    const { id, email } = await invite(t);
    const guest = await signUp("Guest", email);
    return {
      path: `/invitations/${id}/decline`,
      init: { method: "POST" },
      cookie: guest.cookie,
      status: 200,
    };
  },
  acknowledgeIncident: async () => {
    const t = await team();
    const incident = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: incident, title: "Checkout down", severity: "sev2" });
    return {
      path: `/workspaces/${t.id}/incidents/${incident}/ack`,
      init: { method: "POST", headers: { [IDEMPOTENCY_KEY_HEADER]: "ack-1" } },
      cookie: t.caio.cookie,
      status: 200,
    };
  },
  openSync: async () => {
    const t = await team();
    return {
      path: `/sync/${t.id}`,
      init: { headers: { Upgrade: "websocket" } },
      cookie: t.caio.cookie,
      status: 101,
    };
  },
};

/**
 * An API token with every scope for the workspace's owner, written to D1 and listed in its shard as minting does
 * (src/api-tokens.ts), so the operations run with it exactly as with the owner's cookie.
 */
async function ownerToken(workspaceId: string): Promise<string> {
  const owner = await env.DB.prepare(
    `select "userId" as id from member where "organizationId" = ? and role = 'owner' limit 1`,
  )
    .bind(workspaceId)
    .first<{ id: string }>();
  const token = newApiToken();
  const id = newId("tok", Date.now(), random);
  // A moment after every membership the case set up.
  const at = Date.now() + 1000;
  await env.DB.prepare(
    `insert into api_token (id, workspace_id, hash, name, created_by, scopes, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      await tokenDigest(token, undefined),
      "Reference",
      owner!.id,
      JSON.stringify(TOKEN_SCOPES),
      at,
    )
    .run();
  const listed = await env.WORKSPACE.getByName(workspaceId).apiTokenRun(
    workspaceId,
    { kind: "user", id: owner!.id, role: "owner" },
    "apiToken.create",
    { id, name: "Reference", scopes: [...TOKEN_SCOPES], expiresAt: null },
  );
  expect(listed).toEqual({ ok: true });
  return token;
}

/** The case's workspace, from its path. */
const caseWorkspace = (path: string) => /\/(?:workspaces|sync)\/(ws_[0-9A-Z]{26})/.exec(path)?.[1];

function send({ path, init = {}, cookie }: Case): Promise<Response> {
  return api(path, {
    ...init,
    headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) },
  });
}

/** The answer's status is documented for the operation, and its body is what the reference says. */
async function expectDocumented(operation: Operation, response: Response): Promise<void> {
  const answer = operation.responses[response.status];
  expect(answer, `${operation.operationId} documents ${response.status}`).toBeDefined();
  const schema = responseSchema(answer!);
  if (response.status === 101) {
    response.webSocket!.accept();
    open.push(response.webSocket!);
    return;
  }
  if (schema === undefined) return;
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(checkJsonSchema(schema, await response.json(), document)).toEqual([]);
}

/** A documented path with each parameter filled in with a value of the right shape. */
function samplePath(path: string): string {
  const samples: Record<string, string> = {
    workspaceId: newId("ws", Date.now(), random),
    userId: newId("usr", Date.now(), random),
    invitationId: newId("inv", Date.now(), random),
    incidentId: newId("inc", Date.now(), random),
    token: "token",
  };
  return path.replaceAll(/\{(\w+)\}/g, (_, name: string) => samples[name]!);
}

describe("the API reference", () => {
  test("docs/api/openapi.json is what `vp run openapi` writes", () => {
    expect(committed, "run `vp run --filter @freecorps/brigade-api openapi`").toBe(openApiJson());
  });

  test("its patterns and names are the ones the routes check", () => {
    expect(WORKSPACE_ID_PATTERN).toBe(ORGANIZATION_ID.source);
    expect(IDEMPOTENCY_KEY_PATTERN).toBe(TOKEN.source);
    const ack = OPERATIONS.find((operation) => operation.operationId === "acknowledgeIncident");
    expect(ack?.parameters?.map((parameter) => parameter.name)).toContain(IDEMPOTENCY_KEY_HEADER);
  });

  test("operation ids are unique and every one has a case here", () => {
    const ids = OPERATIONS.map((operation) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(CASES).sort()).toEqual([...ids].sort());
  });

  test("every documented path answers exactly its documented methods", async () => {
    const paths = [...new Set(OPERATIONS.map((operation) => operation.path))];
    for (const path of paths) {
      const methods = OPERATIONS.filter((operation) => operation.path === path).map((operation) =>
        operation.method.toUpperCase(),
      );
      const response = await api(samplePath(path), { method: "PUT" });
      expect(response.status, path).toBe(405);
      const allowed = response.headers
        .get("Allow")!
        .split(", ")
        .filter((method) => method !== "HEAD");
      expect(allowed.sort(), path).toEqual(methods.sort());
    }
  });
});

describe("the reference's webhooks", () => {
  type Webhook = {
    post: {
      parameters: { name: string; schema: JsonSchema }[];
      requestBody: { content: { "application/json": { schema: JsonSchema } } };
    };
  };
  const webhooks = document.webhooks as Record<string, Webhook>;

  test("one per payload type", () => {
    expect(Object.keys(webhooks)).toEqual(Object.keys(WEBHOOK_PAYLOADS));
  });

  test("what the API signs and sends matches its type's schema and headers, no other type's", async () => {
    const { deliveries } = await serverSignedFixture();
    for (const delivery of deliveries) {
      const payload = JSON.parse(delivery.body) as { type: string };
      for (const [type, webhook] of Object.entries(webhooks)) {
        const issues = checkJsonSchema(
          webhook.post.requestBody.content["application/json"].schema,
          payload,
          document,
        );
        if (type === payload.type) expect(issues, type).toEqual([]);
        else expect(issues, type).not.toEqual([]);
      }
      for (const parameter of webhooks[payload.type]!.post.parameters) {
        const value = (delivery.headers as Record<string, string>)[parameter.name];
        expect(checkJsonSchema(parameter.schema, value), parameter.name).toEqual([]);
      }
    }
  });
});

describe("each operation answers as documented", () => {
  for (const operation of OPERATIONS) {
    test(`${operation.method.toUpperCase()} ${operation.path}: ${operation.operationId}`, async () => {
      const basic = await CASES[operation.operationId]!();
      const response = await send(basic);
      expect(response.status).toBe(basic.status);
      await expectDocumented(operation, response);

      if (operation.auth === "session") {
        const anonymous = await send({ ...basic, cookie: undefined });
        expect(anonymous.status).toBe(401);
        await expectDocumented(operation, anonymous);
      }

      if (operation.bearer !== undefined) {
        forgetAllTokens();
        const fresh = await CASES[operation.operationId]!();
        const workspace = caseWorkspace(fresh.path);
        expect(workspace, "a bearer operation names its workspace").toBeDefined();
        const withToken = (token: string) =>
          send({
            ...fresh,
            cookie: undefined,
            init: {
              ...fresh.init,
              headers: { ...fresh.init?.headers, Authorization: `Bearer ${token}` },
            },
          });
        const accepted = await withToken(await ownerToken(workspace!));
        expect(accepted.status).toBe(fresh.status);
        await expectDocumented(operation, accepted);
        const wrong = await withToken(newApiToken());
        expect(wrong.status).toBe(401);
        await expectDocumented(operation, wrong);
      }
    });
  }

  test("paging health without a session is only its status", async () => {
    const response = await api("/health/paging");
    expect(response.status).toBe(200);
    expect(Object.keys((await response.json()) as JsonSchema)).toEqual(["status"]);
  });
});
