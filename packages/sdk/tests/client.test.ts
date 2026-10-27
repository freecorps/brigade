// The client against the API reference (docs/api/openapi.json): one method per public operation, each sending the
// documented method to the documented path, and each knowing exactly the refusal codes the reference lists for it.
// Then what it sends and how it reads answers, through an injected `fetch`.
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  BrigadeApiError,
  BrigadeArgumentError,
  createClient,
  isBrigadeApiError,
  OPERATION_ERRORS,
  type ApiErrorCode,
  type BrigadeClient,
} from "../src/index.ts";

type Reference = {
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        parameters?: { name: string; in: string }[];
        responses: Record<
          string,
          {
            content?: {
              "application/json": { schema: { properties?: { error?: { enum?: string[] } } } };
            };
          }
        >;
      }
    >
  >;
};

const reference = JSON.parse(
  readFileSync(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
) as Reference;

/** Every operation in the reference: its method, path and refusal codes. */
const operations = Object.entries(reference.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({
    id: operation.operationId,
    method: method.toUpperCase(),
    path,
    parameters: operation.parameters ?? [],
    errors: Object.values(operation.responses).flatMap(
      (answer) => answer.content?.["application/json"].schema.properties?.error?.enum ?? [],
    ),
  })),
);

const WS = "ws_01M5W19VG0040G2081040G2081";
const USER = "usr_01M5W19VG0081040G2081040G2";
const INV = "inv_01M5W19VG0081040G2081040G2";
const INC = "inc_01M5W19VG0081040G2081040G2";

/** Each method, called with a value per path parameter. */
const CALLS: Record<keyof BrigadeClient, (client: BrigadeClient) => Promise<unknown>> = {
  getHealth: (c) => c.getHealth(),
  getPagingHealth: (c) => c.getPagingHealth(),
  pingHeartbeat: (c) => c.pingHeartbeat(`${WS}.mon_x.secret`),
  sendAlerts: (c) => c.sendAlerts(`${WS}.mon_x.secret`, { title: "Checkout is down" }),
  createWorkspace: (c) => c.createWorkspace({ name: "Acme" }),
  changeMemberRole: (c) => c.changeMemberRole(WS, USER, { role: "admin" }),
  removeMember: (c) => c.removeMember(WS, USER),
  listInvitations: (c) => c.listInvitations(WS),
  invite: (c) => c.invite(WS, { email: "guest@example.com", role: "responder" }),
  revokeInvitation: (c) => c.revokeInvitation(WS, INV),
  resendInvitation: (c) => c.resendInvitation(WS, INV),
  getInvitation: (c) => c.getInvitation(INV),
  acceptInvitation: (c) => c.acceptInvitation(INV),
  declineInvitation: (c) => c.declineInvitation(INV),
  acknowledgeIncident: (c) => c.acknowledgeIncident(WS, INC, { idempotencyKey: "ack-1" }),
};

const VALUES: Record<string, string> = {
  workspaceId: WS,
  userId: USER,
  invitationId: INV,
  incidentId: INC,
  token: `${WS}.mon_x.secret`,
};

function recorder(answer: () => Response = () => Response.json({ ok: true })) {
  const requests: Request[] = [];
  const client = createClient({
    baseUrl: "https://brigade.example.com/api/",
    fetch: async (request) => {
      requests.push(request);
      return answer();
    },
  });
  return { client, requests };
}

describe("matches the reference", () => {
  test("a method per operation, except the sync WebSocket", () => {
    expect(Object.keys(CALLS).sort()).toEqual(
      operations
        .map((operation) => operation.id)
        .filter((id) => id !== "openSync")
        .sort(),
    );
    expect(Object.keys(OPERATION_ERRORS).sort()).toEqual(Object.keys(CALLS).sort());
  });

  test("each refusal code the reference lists, no more", () => {
    for (const operation of operations) {
      if (operation.id === "openSync") continue;
      const codes = OPERATION_ERRORS[operation.id as keyof typeof OPERATION_ERRORS];
      expect([...new Set(codes)].sort(), operation.id).toEqual(
        [...new Set(operation.errors)].sort(),
      );
    }
  });

  test("each method sends its method to its path, under the base URL", async () => {
    for (const operation of operations) {
      if (operation.id === "openSync") continue;
      const { client, requests } = recorder();
      await CALLS[operation.id as keyof BrigadeClient](client);
      const path = operation.path.replace(/\{(\w+)\}/g, (_, name: string) =>
        encodeURIComponent(VALUES[name]!),
      );
      expect(`${requests[0]!.method} ${requests[0]!.url}`, operation.id).toBe(
        `${operation.method} https://brigade.example.com/api${path}`,
      );
      for (const parameter of operation.parameters.filter((one) => one.in === "header")) {
        expect(requests[0]!.headers.get(parameter.name), operation.id).not.toBeNull();
      }
    }
  });
});

describe("requests", () => {
  test("a JSON body, the cookie, headers from the hook made per request", async () => {
    const requests: Request[] = [];
    let n = 0;
    const client = createClient({
      baseUrl: "https://brigade.example.com/api",
      cookie: "better-auth.session_token=abc",
      headers: async () => ({ "X-Request": String(++n) }),
      fetch: async (request) => {
        requests.push(request);
        return Response.json({ id: WS, name: "Acme" }, { status: 201 });
      },
    });
    expect(await client.createWorkspace({ name: "Acme" })).toEqual({ id: WS, name: "Acme" });
    await client.createWorkspace({ name: "Acme" });
    const [first, second] = requests;
    expect(first!.headers.get("Content-Type")).toBe("application/json");
    expect(first!.headers.get("Cookie")).toBe("better-auth.session_token=abc");
    expect(await first!.json()).toEqual({ name: "Acme" });
    expect([first!.headers.get("X-Request"), second!.headers.get("X-Request")]).toEqual(["1", "2"]);
  });

  test("a token goes as Authorization: Bearer, over a header the hook set", async () => {
    const requests: Request[] = [];
    const client = createClient({
      baseUrl: "https://brigade.example.com/api",
      token: "brg_example",
      headers: () => ({ Authorization: "Basic nope" }),
      fetch: async (request) => {
        requests.push(request);
        return Response.json({ ok: true });
      },
    });
    await client.acknowledgeIncident(WS, INC);
    expect(requests[0]!.headers.get("Authorization")).toBe("Bearer brg_example");
    expect(requests[0]!.headers.get("Cookie")).toBeNull();
  });

  test("an ack sends a fresh Idempotency-Key unless given one, within the API's pattern", async () => {
    const { client, requests } = recorder();
    await client.acknowledgeIncident(WS, INC);
    await client.acknowledgeIncident(WS, INC);
    await client.acknowledgeIncident(WS, INC, { idempotencyKey: "retry:1" });
    const keys = requests.map((request) => request.headers.get("Idempotency-Key"));
    expect(keys[0]).toMatch(/^[\w:-]{1,64}$/);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe("retry:1");
  });

  test("path segments are encoded", async () => {
    const { client, requests } = recorder();
    await client.pingHeartbeat("a/b?c");
    expect(requests[0]!.url).toBe("https://brigade.example.com/api/heartbeat/a%2Fb%3Fc");
  });

  test("an empty, `.` or `..` id is refused before any request", async () => {
    const { client, requests } = recorder();
    for (const id of ["", ".", ".."]) {
      for (const call of [
        () => client.acknowledgeIncident(WS, id),
        () => client.acknowledgeIncident(id, INC),
        () => client.pingHeartbeat(id),
        () => client.getInvitation(id),
      ]) {
        // A rejection, like every other refusal: never a throw from the call itself.
        const error = await call().catch((caught: unknown) => caught);
        expect(error, JSON.stringify(id)).toBeInstanceOf(BrigadeArgumentError);
        expect(error).toMatchObject({ code: "invalid_argument" });
      }
    }
    expect(requests).toHaveLength(0);
    // Dots inside an id are fine.
    await client.pingHeartbeat("a..b");
    expect(requests[0]!.url).toBe("https://brigade.example.com/api/heartbeat/a..b");
  });

  test("redirects are not followed; credentials only when asked", async () => {
    const { client, requests } = recorder();
    await client.getHealth();
    expect(requests[0]!.redirect).toBe("manual");
    const sent: Request[] = [];
    const browser = createClient({
      baseUrl: "https://brigade.example.com/api",
      credentials: "include",
      fetch: async (request) => {
        sent.push(request);
        return Response.json({ ok: true });
      },
    });
    await browser.getHealth();
    expect(sent[0]!.credentials).toBe("include");
  });
});

describe("refusals", () => {
  test("a documented code, typed per operation", async () => {
    const { client } = recorder(() =>
      Response.json({ error: "invalid_transition" }, { status: 409 }),
    );
    const error = await client.acknowledgeIncident(WS, INC).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BrigadeApiError);
    expect(error).toMatchObject({
      operation: "acknowledgeIncident",
      status: 409,
      code: "invalid_transition",
      body: { error: "invalid_transition" },
    });
    if (!isBrigadeApiError(error, "acknowledgeIncident")) throw error;
    expectTypeOf(error.code).toEqualTypeOf<ApiErrorCode<"acknowledgeIncident">>();
    expect(isBrigadeApiError(error, "invite")).toBe(false);
    expect(isBrigadeApiError(error)).toBe(true);
  });

  test("an undocumented code, a body that is no JSON, or none, is unexpected", async () => {
    for (const answer of [
      () => Response.json({ error: "something_new" }, { status: 409 }),
      () => new Response("<html>Bad gateway</html>", { status: 502 }),
      () => new Response(null, { status: 405 }),
      () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example" } }),
      // A 2xx that is not the API: a captive portal's page, nothing, or JSON that is no object.
      () => new Response("<html>Sign in to the Wi-Fi</html>", { status: 200 }),
      () => new Response(null, { status: 204 }),
      () => Response.json(null),
      () => Response.json("ok"),
      () => Response.json([]),
    ]) {
      const { client } = recorder(answer);
      const error = await client.getPagingHealth().catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "unexpected" });
    }
  });

  test("a network failure is fetch's own", async () => {
    const client = createClient({
      baseUrl: "https://brigade.example.com/api",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(client.getHealth()).rejects.toThrow(TypeError);
  });
});
