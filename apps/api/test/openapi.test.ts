// The API reference (src/openapi.ts, RFC 0002 "Public HTTP API") against the Worker: the committed
// docs/api/openapi.json is what the generator writes; every documented path answers exactly its documented methods;
// every operation answers its documented success, with a body its schema accepts, for a basic case; every session
// operation answers 401 without one; and every operation marked `bearerAuth` answers the same success with an API
// token instead of the cookie (RFC 0014), and 401 with a wrong one.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import {
  alertSourceToken,
  checkJsonSchema,
  heartbeatToken,
  idPattern,
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
  WEBHOOK_IDEMPOTENCY_KEY_PATTERN,
  OPERATIONS,
  openApiDocument,
  openApiJson,
  responseSchema,
  WORKSPACE_ID_PATTERN,
  type Operation,
} from "../src/openapi.ts";
import { APP_SIGN_IN_ID } from "../src/app-sign-in.ts";
import { forgetAllTokens, newApiToken, tokenDigest } from "../src/api-tokens.ts";
import { Shard } from "../src/shard.ts";
import { serverSignedFixture } from "./sdk-fixture.ts";
import { workerAuth } from "../src/index.ts";
import { requestDraftRoute } from "../src/postmortem.ts";
import { WEBHOOK_IDEMPOTENCY_KEY } from "../src/webhook-routes.ts";
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

/** An incident declared in the team's workspace. */
async function declared(t: Team): Promise<string> {
  const id = newId("inc", Date.now(), random);
  await t.run("incident.declare", { id, title: "Checkout down", severity: "sev2" });
  return id;
}

/** A service, incident type or text custom field in the team's catalog. */
async function catalogEntry(t: Team, prefix: "svc" | "typ" | "fld"): Promise<string> {
  const id = newId(prefix, Date.now(), random);
  if (prefix === "svc") {
    await t.run("service.create", {
      id,
      name: "Checkout",
      description: "",
      tier: "tier1",
      owners: [],
      escalationPolicyId: null,
    });
  } else if (prefix === "typ") {
    await t.run("incidentType.create", {
      id,
      name: "Security",
      description: "",
      defaultSeverity: null,
      escalationPolicyId: null,
      requiredFields: [],
    });
  } else {
    await t.run("customField.create", {
      id,
      name: "Region",
      description: "",
      kind: "text",
      options: [],
    });
  }
  return id;
}

/**
 * One request for an operation: its path filled in, and who sends it. `route`: called instead of the Worker, for a
 * route that needs a binding the tests do not have (Workers AI).
 */
type Case = {
  path: string;
  init?: Init;
  cookie?: string;
  status: number;
  route?: (request: Request) => Promise<Response>;
};

/** A webhook endpoint made through the API as the team's owner. */
async function webhookEndpoint(t: Team): Promise<string> {
  const id = newId("whk", Date.now(), random);
  const response = await api(`/workspaces/${t.id}/webhooks`, {
    method: "POST",
    headers: { Cookie: t.ana.cookie },
    body: JSON.stringify({
      id,
      url: "https://hooks.example.com/brigade",
      description: "",
      events: ["incident.declared"],
    }),
  });
  expect(response.status).toBe(201);
  return id;
}

/** Workers AI, faked: a draft as the model answers it. */
const fakeAi = {
  run: async () => ({
    response: JSON.stringify({
      summary: "Checkout was down.",
      impact: "Card payments.",
      timeline: "12:00 declared",
      rootCause: "To be found.",
      wentWell: "Quick rollback.",
      wentPoorly: "Late alert.",
      followUps: "- Retry budget",
    }),
  }),
};

/** A basic case per operation, by `operationId`: what it takes to get its documented success. */
const CASES: Record<string, () => Promise<Case>> = {
  createWebhook: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/webhooks`,
      init: {
        method: "POST",
        body: JSON.stringify({
          id: newId("whk", Date.now(), random),
          url: "https://hooks.example.com/brigade",
          description: "Ops bot",
          events: ["incident.declared"],
          headers: [{ name: "Authorization", value: "Bearer receiver-token-0123456789" }],
        }),
      },
      cookie: t.ana.cookie,
      status: 201,
    };
  },
  rotateWebhookSecret: async () => {
    const t = await team();
    const id = await webhookEndpoint(t);
    return {
      path: `/workspaces/${t.id}/webhooks/${id}/rotate`,
      init: { method: "POST" },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  setWebhookHeaders: async () => {
    const t = await team();
    const id = await webhookEndpoint(t);
    return {
      path: `/workspaces/${t.id}/webhooks/${id}/headers`,
      init: {
        method: "PUT",
        body: JSON.stringify({ headers: [{ name: "X-Team", value: "ops" }] }),
      },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  configureStatusPage: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/status-page`,
      init: {
        method: "PUT",
        body: JSON.stringify({
          slug: `acme-${crypto.randomUUID().slice(0, 8)}`,
          title: "Acme status",
          locale: "en",
          enabled: true,
        }),
      },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  createExport: async () => {
    const t = await team();
    const incidentId = await declared(t);
    return {
      path: `/workspaces/${t.id}/exports`,
      init: { method: "POST", body: JSON.stringify({ scope: { kind: "incident", incidentId } }) },
      cookie: t.ana.cookie,
      status: 201,
    };
  },
  downloadExport: async () => {
    const t = await team();
    const incidentId = await declared(t);
    const made = await api(`/workspaces/${t.id}/exports`, {
      method: "POST",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ scope: { kind: "incident", incidentId } }),
    });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    return { path: `/workspaces/${t.id}/exports/${id}`, cookie: t.ana.cookie, status: 200 };
  },
  requestPostmortemDraft: async () => {
    const t = await team();
    const incidentId = await declared(t);
    return {
      path: `/workspaces/${t.id}/incidents/${incidentId}/postmortem/draft`,
      init: { method: "POST", body: JSON.stringify({ locale: "en" }) },
      cookie: t.ana.cookie,
      status: 202,
      route: async (request) => {
        const ctx = createExecutionContext();
        return requestDraftRoute(
          request,
          { ...env, AI: fakeAi },
          ctx,
          () => workerAuth(env, ctx, request),
          t.id,
          incidentId,
        );
      },
    };
  },
  listPostmortemRevisions: async () => {
    const t = await team();
    const incidentId = await declared(t);
    return {
      path: `/workspaces/${t.id}/incidents/${incidentId}/postmortem/revisions`,
      cookie: t.ana.cookie,
      status: 200,
    };
  },
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
  listIncidents: async () => {
    const t = await team();
    await t.run("incident.declare", {
      id: newId("inc", Date.now(), random),
      title: "Checkout down",
    });
    return {
      path: `/workspaces/${t.id}/incidents?status=triage&limit=10`,
      cookie: t.caio.cookie,
      status: 200,
    };
  },
  declareIncident: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/incidents`,
      init: {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "declare-1" },
        body: JSON.stringify({ title: "Checkout down", severity: "sev2" }),
      },
      cookie: t.caio.cookie,
      status: 201,
    };
  },
  getIncident: async () => {
    const t = await team();
    const incident = await declared(t);
    return {
      path: `/workspaces/${t.id}/incidents/${incident}`,
      cookie: t.caio.cookie,
      status: 200,
    };
  },
  updateIncident: async () => {
    const t = await team();
    const incident = await declared(t);
    const field = await catalogEntry(t, "fld");
    return {
      path: `/workspaces/${t.id}/incidents/${incident}`,
      init: {
        method: "PATCH",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "patch-1" },
        body: JSON.stringify({
          severity: "sev1",
          status: "investigating",
          fields: { [field]: "eu-west" },
        }),
      },
      cookie: t.caio.cookie,
      status: 200,
    };
  },
  postIncidentUpdate: async () => {
    const t = await team();
    const incident = await declared(t);
    return {
      path: `/workspaces/${t.id}/incidents/${incident}/updates`,
      init: {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "update-1" },
        body: JSON.stringify({ body: "Rolling back the deploy." }),
      },
      cookie: t.caio.cookie,
      status: 201,
    };
  },
  editIncidentUpdate: async () => {
    const t = await team();
    const incident = await declared(t);
    // Posted by the owner (`t.run`), so edited by them: only the author edits.
    await t.run("incident.postUpdate", { id: incident, body: "Rolling back." });
    return {
      path: `/workspaces/${t.id}/incidents/${incident}/updates/${incident}:2`,
      init: {
        method: "PATCH",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "edit-1" },
        body: JSON.stringify({ body: "Rolled back." }),
      },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  deleteIncidentUpdate: async () => {
    const t = await team();
    const incident = await declared(t);
    await t.run("incident.postUpdate", { id: incident, body: "Rolling back." });
    return {
      path: `/workspaces/${t.id}/incidents/${incident}/updates/${incident}:2`,
      init: { method: "DELETE", headers: { [IDEMPOTENCY_KEY_HEADER]: "delete-1" } },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  listServices: async () => {
    const t = await team();
    await catalogEntry(t, "svc");
    return { path: `/workspaces/${t.id}/services`, cookie: t.caio.cookie, status: 200 };
  },
  createService: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/services`,
      init: {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "service-1" },
        body: JSON.stringify({ name: "Checkout", tier: "tier1" }),
      },
      cookie: t.ana.cookie,
      status: 201,
    };
  },
  getService: async () => {
    const t = await team();
    const id = await catalogEntry(t, "svc");
    return { path: `/workspaces/${t.id}/services/${id}`, cookie: t.caio.cookie, status: 200 };
  },
  updateService: async () => {
    const t = await team();
    const id = await catalogEntry(t, "svc");
    return {
      path: `/workspaces/${t.id}/services/${id}`,
      init: {
        method: "PATCH",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "service-2" },
        body: JSON.stringify({ tier: "tier2" }),
      },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  deleteService: async () => {
    const t = await team();
    const id = await catalogEntry(t, "svc");
    return {
      path: `/workspaces/${t.id}/services/${id}`,
      init: { method: "DELETE", headers: { [IDEMPOTENCY_KEY_HEADER]: "service-3" } },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  listIncidentTypes: async () => {
    const t = await team();
    await catalogEntry(t, "typ");
    return { path: `/workspaces/${t.id}/incident-types`, cookie: t.caio.cookie, status: 200 };
  },
  createIncidentType: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/incident-types`,
      init: {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "type-1" },
        body: JSON.stringify({ name: "Security", defaultSeverity: "sev1" }),
      },
      cookie: t.ana.cookie,
      status: 201,
    };
  },
  getIncidentType: async () => {
    const t = await team();
    const id = await catalogEntry(t, "typ");
    return { path: `/workspaces/${t.id}/incident-types/${id}`, cookie: t.caio.cookie, status: 200 };
  },
  updateIncidentType: async () => {
    const t = await team();
    const id = await catalogEntry(t, "typ");
    return {
      path: `/workspaces/${t.id}/incident-types/${id}`,
      init: {
        method: "PATCH",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "type-2" },
        body: JSON.stringify({ description: "Anything a customer can see." }),
      },
      cookie: t.ana.cookie,
      status: 200,
    };
  },
  listCustomFields: async () => {
    const t = await team();
    await catalogEntry(t, "fld");
    return { path: `/workspaces/${t.id}/custom-fields`, cookie: t.caio.cookie, status: 200 };
  },
  createCustomField: async () => {
    const t = await team();
    return {
      path: `/workspaces/${t.id}/custom-fields`,
      init: {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "field-1" },
        body: JSON.stringify({
          name: "Customer impact",
          kind: "single_select",
          options: [{ label: "None" }, { label: "Some" }],
        }),
      },
      cookie: t.ana.cookie,
      status: 201,
    };
  },
  getCustomField: async () => {
    const t = await team();
    const id = await catalogEntry(t, "fld");
    return { path: `/workspaces/${t.id}/custom-fields/${id}`, cookie: t.caio.cookie, status: 200 };
  },
  updateCustomField: async () => {
    const t = await team();
    const id = await catalogEntry(t, "fld");
    return {
      path: `/workspaces/${t.id}/custom-fields/${id}`,
      init: {
        method: "PATCH",
        headers: { [IDEMPOTENCY_KEY_HEADER]: "field-2" },
        body: JSON.stringify({ name: "Region affected" }),
      },
      cookie: t.ana.cookie,
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
  createAppSignIn: async () => {
    const ana = await signUp("Ana");
    return { path: "/app-sign-in", init: { method: "POST" }, cookie: ana.cookie, status: 201 };
  },
  getAppSignIn: async () => {
    const { ana, id } = await appSignIn();
    return { path: `/app-sign-in/${id}`, cookie: ana.cookie, status: 200 };
  },
  approveAppSignIn: async () => {
    const { ana, id, claim } = await appSignIn(true);
    return {
      path: `/app-sign-in/${id}/approve`,
      init: { method: "POST", body: JSON.stringify({ number: claim!.number }) },
      cookie: ana.cookie,
      status: 200,
    };
  },
  denyAppSignIn: async () => {
    const { ana, id } = await appSignIn(true);
    return {
      path: `/app-sign-in/${id}/deny`,
      init: { method: "POST" },
      cookie: ana.cookie,
      status: 200,
    };
  },
  claimAppSignIn: async () => {
    const { code } = await appSignIn();
    return {
      path: "/app-sign-in/claim",
      init: { method: "POST", body: JSON.stringify({ code, deviceName: "Ana's iPhone" }) },
      status: 201,
    };
  },
  pollAppSignIn: async () => {
    const { claim } = await appSignIn(true);
    return {
      path: `/app-sign-in/claim/${claim!.claimId}`,
      init: { headers: { Authorization: `Bearer ${claim!.secret}` } },
      status: 200,
    };
  },
};

/** A QR sign-in Ana asked for (src/app-sign-in.ts), claimed by a phone with `claimed`. */
async function appSignIn(claimed = false) {
  const ana = await signUp("Ana");
  const created = await api("/app-sign-in", { method: "POST", headers: { Cookie: ana.cookie } });
  expect(created.status).toBe(201);
  const { id, code } = (await created.json()) as { id: string; code: string };
  if (!claimed) return { ana, id, code, claim: undefined };
  const response = await api("/app-sign-in/claim", {
    method: "POST",
    body: JSON.stringify({ code, deviceName: "Ana's iPhone" }),
  });
  expect(response.status).toBe(201);
  const claim = (await response.json()) as { claimId: string; secret: string; number: string };
  return { ana, id, code, claim };
}

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

function send({ path, init = {}, cookie, route }: Case): Promise<Response> {
  const headers = { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) };
  if (!route) return api(path, { ...init, headers });
  return route(
    new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    }),
  );
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
    serviceId: newId("svc", Date.now(), random),
    typeId: newId("typ", Date.now(), random),
    fieldId: newId("fld", Date.now(), random),
    webhookId: newId("whk", Date.now(), random),
    exportId: newId("exp", Date.now(), random),
    signInId: newId("asi", Date.now(), random),
    claimId: newId("asi", Date.now(), random),
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
    expect(WEBHOOK_IDEMPOTENCY_KEY_PATTERN).toBe(WEBHOOK_IDEMPOTENCY_KEY.source);
    expect(idPattern("asi")).toBe(APP_SIGN_IN_ID.source);
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
      // A method none of them is: PUT, or PATCH where PUT is one.
      const probe = methods.includes("PUT") ? "PATCH" : "PUT";
      const response = await api(samplePath(path), { method: probe });
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
    // A bearer operation builds its case twice: two teams (four password hashes) and, for an invitation's, two
    // invitations. On a loaded runner that alone passes the default 5 s.
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
    }, 20_000);
  }

  test("paging health without a session is only its status", async () => {
    const response = await api("/health/paging");
    expect(response.status).toBe(200);
    expect(Object.keys((await response.json()) as JsonSchema)).toEqual(["status"]);
  });
});
