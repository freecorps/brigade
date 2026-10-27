// The public HTTP API's incident and catalog routes (RFC 0002 "Public HTTP API"): incidents listed, read, declared,
// changed and written to; services, incident types and custom fields listed, read, made and changed. The Worker
// checks the path, the `Idempotency-Key` and the body against the schema package's validators, authenticates the
// session or the API token (RFC 0014, `callerOf`: a token only within its scopes) and reads the member's role in D1;
// the shard then reads or runs the named mutations as that member or token (src/rest.ts, `WorkspaceDO.restRead` and
// `restWrite`), with the same RBAC, timeline entries and outbox events as the dashboard's.

import {
  customFieldCreateRequest,
  customFieldPatchRequest,
  declareRequest,
  INCIDENT_PAGE_MAX,
  INCIDENT_STATUSES,
  incidentPatchRequest,
  incidentTypeCreateRequest,
  incidentTypePatchRequest,
  isId,
  serviceCreateRequest,
  servicePatchRequest,
  SEVERITIES,
  updateRequest,
  type Actor,
  type Issue,
  type Permission,
  type Validator,
} from "@freecorps/brigade-schema";
import { TOKEN } from "@freecorps/brigade-sync/protocol";
import { memberRole } from "./actor.ts";
import { callerOf, unauthenticated } from "./api-tokens.ts";
import type { Auth } from "./auth.ts";
import { readBounded } from "./body.ts";
import { REST_STATUS } from "./http.ts";
import {
  READ_PERMISSION,
  WRITE_PERMISSION,
  type IncidentFilter,
  type RestRead,
  type RestResult,
  type RestWrite,
} from "./rest.ts";
import { IDEMPOTENCY_KEY_HEADER, ORGANIZATION_ID } from "./workspace.ts";

export type RestEnv = Pick<Env, "DB" | "WORKSPACE" | "API_TOKEN_LIMIT"> & {
  API_TOKEN_KEY?: string;
};

const INCIDENTS_PATH = /^\/workspaces\/([^/]+)\/incidents(?:\/([^/]+)(\/updates)?)?$/;
const CATALOG_PATH =
  /^\/workspaces\/([^/]+)\/(services|incident-types|custom-fields)(?:\/([^/]+))?$/;

/** Largest body read: an update (4000 characters) or every custom field's value fits well under it. */
export const MAX_REST_BODY_BYTES = 64 * 1024;

/** Each catalog collection: its ids' prefix, and what its routes read and write. */
type CatalogEntry = {
  prefix: string;
  list: RestRead;
  one: (id: string) => RestRead;
  create: (serve: Route) => Promise<Response>;
  patch: (serve: Route, id: string) => Promise<Response>;
  remove?: (serve: Route, id: string) => Promise<Response>;
};

const CATALOG: Record<string, CatalogEntry> = {
  services: {
    prefix: "svc",
    list: { kind: "services" },
    one: (id) => ({ kind: "service", id }),
    create: (serve) =>
      serve.write(serviceCreateRequest, (body) => ({ kind: "createService", body }), 201),
    patch: (serve, id) =>
      serve.write(servicePatchRequest, (body) => ({ kind: "updateService", id, body })),
    remove: (serve, id) => serve.write(undefined, () => ({ kind: "deleteService", id })),
  },
  "incident-types": {
    prefix: "typ",
    list: { kind: "incidentTypes" },
    one: (id) => ({ kind: "incidentType", id }),
    create: (serve) =>
      serve.write(incidentTypeCreateRequest, (body) => ({ kind: "createIncidentType", body }), 201),
    patch: (serve, id) =>
      serve.write(incidentTypePatchRequest, (body) => ({ kind: "updateIncidentType", id, body })),
  },
  "custom-fields": {
    prefix: "fld",
    list: { kind: "customFields" },
    one: (id) => ({ kind: "customField", id }),
    create: (serve) =>
      serve.write(customFieldCreateRequest, (body) => ({ kind: "createCustomField", body }), 201),
    patch: (serve, id) =>
      serve.write(customFieldPatchRequest, (body) => ({ kind: "updateCustomField", id, body })),
  },
};

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers });

const notAllowed = (allow: string) => json({ error: "method_not_allowed" }, 405, { Allow: allow });

/** The route for `pathname`, or undefined when it is none of these. */
export function restRoute(
  request: Request,
  env: RestEnv,
  lazyAuth: () => Auth,
  pathname: string,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> | undefined {
  const incidents = INCIDENTS_PATH.exec(pathname);
  if (incidents) {
    const [, workspaceId, incidentId, updates] = incidents;
    const serve = new Route(request, env, lazyAuth, workspaceId!, waitUntil);
    if (incidentId === undefined) {
      if (request.method === "GET") return serve.read(incidentFilter(request));
      if (request.method === "POST") {
        return serve.write(declareRequest, (body) => ({ kind: "declare", body }), 201);
      }
      return Promise.resolve(notAllowed("GET, POST"));
    }
    if (updates) {
      if (request.method !== "POST") return Promise.resolve(notAllowed("POST"));
      if (!isId("inc", incidentId)) return serve.notFound();
      return serve.write(
        updateRequest,
        (body) => ({ kind: "postUpdate", id: incidentId, body }),
        201,
      );
    }
    if (request.method !== "GET" && request.method !== "PATCH") {
      return Promise.resolve(notAllowed("GET, PATCH"));
    }
    if (!isId("inc", incidentId)) return serve.notFound();
    if (request.method === "GET") return serve.read({ kind: "incident", id: incidentId });
    return serve.write(incidentPatchRequest, (body) => ({
      kind: "updateIncident",
      id: incidentId,
      body,
    }));
  }
  const catalog = CATALOG_PATH.exec(pathname);
  if (!catalog) return undefined;
  const [, workspaceId, collection, id] = catalog;
  const entry = CATALOG[collection!]!;
  const serve = new Route(request, env, lazyAuth, workspaceId!, waitUntil);
  if (id === undefined) {
    if (request.method === "GET") return serve.read(entry.list);
    if (request.method === "POST") return entry.create(serve);
    return Promise.resolve(notAllowed("GET, POST"));
  }
  const allow = entry.remove ? "GET, PATCH, DELETE" : "GET, PATCH";
  if (!allow.split(", ").includes(request.method)) return Promise.resolve(notAllowed(allow));
  if (!isId(entry.prefix, id)) return serve.notFound();
  if (request.method === "GET") return serve.read(entry.one(id));
  if (request.method === "DELETE") return entry.remove!(serve, id);
  return entry.patch(serve, id);
}

/** `GET /workspaces/:id/incidents`'s query: each filter, or the issues with it. */
function incidentFilter(request: Request): RestRead | Issue[] {
  const params = new URL(request.url).searchParams;
  const issues: Issue[] = [];
  const filter: IncidentFilter = {};
  const list = <T extends string>(name: string, values: readonly T[]): T[] | undefined => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    const items = raw.split(",");
    if (!items.every((item): item is T => (values as readonly string[]).includes(item))) {
      issues.push({
        path: name,
        message: `Expected a comma-separated list of ${values.join(", ")}`,
      });
    }
    return items as T[];
  };
  const id = (name: string, prefix: string): string | undefined => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    if (!isId(prefix, raw)) issues.push({ path: name, message: `Expected a ${prefix}_ id` });
    return raw;
  };
  const status = list("status", INCIDENT_STATUSES);
  const severity = list("severity", SEVERITIES);
  const typeId = id("typeId", "typ");
  const serviceId = id("serviceId", "svc");
  const cursor = id("cursor", "inc");
  if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (typeId) filter.typeId = typeId;
  if (serviceId) filter.serviceId = serviceId;
  if (cursor) filter.cursor = cursor;
  const limit = params.get("limit");
  if (limit !== null) {
    const n = Number(limit);
    if (!/^[0-9]{1,3}$/.test(limit) || n < 1 || n > INCIDENT_PAGE_MAX) {
      issues.push({ path: "limit", message: `Expected 1 to ${INCIDENT_PAGE_MAX}` });
    } else filter.limit = n;
  }
  return issues.length ? issues : { kind: "incidents", filter };
}

/** One request to these routes: the checks every one of them makes, then the shard. */
class Route {
  constructor(
    private readonly request: Request,
    private readonly env: RestEnv,
    private readonly lazyAuth: () => Auth,
    private readonly workspaceId: string,
    private readonly waitUntil: ((promise: Promise<unknown>) => void) | undefined,
  ) {}

  /** An id of the wrong shape: no such entry. The charset has no `%`, so nothing in a path is decoded. */
  notFound(): Promise<Response> {
    return Promise.resolve(
      ORGANIZATION_ID.test(this.workspaceId)
        ? json({ error: "not_found" }, 404)
        : json({ error: "invalid_workspace_id" }, 400),
    );
  }

  async read(read: RestRead | Issue[]): Promise<Response> {
    if (!ORGANIZATION_ID.test(this.workspaceId))
      return json({ error: "invalid_workspace_id" }, 400);
    if (Array.isArray(read)) return json({ error: "invalid_args", issues: read }, 400);
    const actor = await this.actor(READ_PERMISSION[read.kind]);
    if (actor instanceof Response) return actor;
    return this.call(() =>
      this.env.WORKSPACE.getByName(this.workspaceId).restRead(this.workspaceId, actor, read),
    );
  }

  /** With `validator`, the body is checked against it first; without one, the request has none to read. */
  async write<B>(
    validator: Validator<B> | undefined,
    make: (body: B) => RestWrite,
    success = 200,
  ): Promise<Response> {
    if (!ORGANIZATION_ID.test(this.workspaceId))
      return json({ error: "invalid_workspace_id" }, 400);
    const key = this.request.headers.get(IDEMPOTENCY_KEY_HEADER);
    if (key === null || !TOKEN.test(key)) {
      const issues = [
        { path: IDEMPOTENCY_KEY_HEADER, message: "Expected 1 to 64 of A-Z a-z 0-9 _ : -" },
      ];
      return json({ error: "invalid_args", issues }, 400);
    }
    // The kind, for the permission, before the body is read: `make` only shapes what it is given.
    const kind = make(undefined as B).kind;
    const actor = await this.actor(WRITE_PERMISSION[kind]);
    if (actor instanceof Response) return actor;
    let body = undefined as B;
    if (validator) {
      const parsed = await readJson(this.request);
      if (!parsed.ok) return json({ error: "invalid_args", issues: parsed.issues }, 400);
      const checked = validator(parsed.value);
      if (!checked.ok) return json({ error: "invalid_args", issues: checked.issues }, 400);
      body = checked.value;
    }
    const write = make(body);
    return this.call(
      () =>
        this.env.WORKSPACE.getByName(this.workspaceId).restWrite(
          this.workspaceId,
          actor,
          write,
          key,
        ),
      success,
    );
  }

  /**
   * Who the request acts as: the API token (with `permission` among its scopes) or the session's member, whose role
   * is read in D1 here, so a made-up workspace or an outsider never wakes (or creates) a shard.
   */
  private async actor(permission: Permission): Promise<Actor | Response> {
    const resolved = await callerOf(
      this.request,
      this.env,
      this.lazyAuth,
      this.workspaceId,
      permission,
      this.waitUntil,
    );
    if (!resolved.ok) return resolved.response;
    const { caller } = resolved;
    if (caller.kind === "token") return caller.actor;
    try {
      const role = await memberRole(this.env.DB, this.workspaceId, caller.userId);
      if (role === undefined) return json({ error: "not_a_member" }, 403);
      return { kind: "user", id: caller.userId, role };
    } catch (error) {
      console.error(JSON.stringify({ message: "member lookup failed", error: String(error) }));
      return json({ error: "unavailable" }, 503);
    }
  }

  private async call(rpc: () => Promise<RestResult>, success = 200): Promise<Response> {
    let result: RestResult;
    try {
      result = await rpc();
    } catch (error) {
      const flag = (name: string) =>
        typeof error === "object" && error !== null && Reflect.get(error, name) === true;
      console.error(
        JSON.stringify({
          message: "WorkspaceDO REST call failed",
          workspace: this.workspaceId,
          error: String(error),
        }),
      );
      return flag("retryable") || flag("overloaded")
        ? json({ error: "unavailable" }, 503)
        : json({ error: "internal" }, 500);
    }
    if (result.ok) return json(result.body, success);
    if (result.code === "unauthenticated") return unauthenticated();
    const status = REST_STATUS[result.code];
    if (status === undefined) return json({ error: "internal" }, 500);
    return json(
      result.issues ? { error: result.code, issues: result.issues } : { error: result.code },
      status,
    );
  }
}

/** The request's body as JSON, at most `MAX_REST_BODY_BYTES`. */
async function readJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; issues: Issue[] }> {
  const text = await readBounded(request, MAX_REST_BODY_BYTES);
  if (text === undefined) {
    return { ok: false, issues: [{ path: "", message: `At most ${MAX_REST_BODY_BYTES} bytes` }] };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, issues: [{ path: "", message: "Expected JSON" }] };
  }
}
