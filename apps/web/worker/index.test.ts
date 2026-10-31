import { describe, expect, test, vi } from "vite-plus/test";
import { apiPath, handle, type Upstream } from "./index.ts";

/** A stub binding that records every request it receives. */
function upstream(respond: (request: Request) => Response | Promise<Response>) {
  const seen: Request[] = [];
  const binding: Upstream = {
    fetch: async (request) => {
      seen.push(request);
      return respond(request);
    },
  };
  return { binding, seen };
}

function bindings() {
  const api = upstream((request) => Response.json({ path: new URL(request.url).pathname }));
  const assets = upstream(
    () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
  );
  return { api, assets, env: { API: api.binding, ASSETS: assets.binding } };
}

describe("web worker routing", () => {
  test("strips the /api prefix and nothing else", () => {
    expect(apiPath("/api/health")).toBe("/health");
    expect(apiPath("/api/workspaces/demo")).toBe("/workspaces/demo");
    expect(apiPath("/api/")).toBe("/");
    expect(apiPath("/api")).toBe("/");
    expect(apiPath("/apis")).toBeUndefined();
    expect(apiPath("/")).toBeUndefined();
    expect(apiPath("/incidents/api/x")).toBeUndefined();
  });

  test("forwards /api/* to the API binding with the prefix stripped", async () => {
    const { api, assets, env } = bindings();
    const response = await handle(new Request("http://web.test/api/workspaces/demo?x=1"), env);
    expect(await response.json()).toEqual({ path: "/workspaces/demo" });
    expect(api.seen.map((request) => request.url)).toEqual(["http://web.test/workspaces/demo?x=1"]);
    expect(assets.seen).toHaveLength(0);
  });

  test("keeps the method, headers and body when forwarding", async () => {
    const { api, env } = bindings();
    await handle(
      new Request("http://web.test/api/health", {
        method: "POST",
        headers: { "content-type": "application/json", "x-trace": "abc" },
        body: '{"a":1}',
      }),
      env,
    );
    const [forwarded] = api.seen;
    expect(forwarded?.method).toBe("POST");
    expect(forwarded?.headers.get("x-trace")).toBe("abc");
    expect(await forwarded?.text()).toBe('{"a":1}');
  });

  test("passes the API's status through", async () => {
    const { env } = bindings();
    const api = upstream(() => Response.json({ error: "not_found" }, { status: 404 }));
    const response = await handle(new Request("http://web.test/api/nope"), {
      ...env,
      API: api.binding,
    });
    expect(response.status).toBe(404);
  });

  test("answers 502 when the API binding throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = bindings();
    const api = upstream(() => Promise.reject(new Error("no such service")));
    const response = await handle(new Request("http://web.test/api/health"), {
      ...env,
      API: api.binding,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "api_unreachable" });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  test("serves everything else from static assets", async () => {
    const { api, assets, env } = bindings();
    for (const path of ["/", "/incidents/42", "/apis", "/assets/index.js"]) {
      const response = await handle(new Request(`http://web.test${path}`), env);
      expect(response.headers.get("content-type"), path).toBe("text/html");
    }
    expect(assets.seen).toHaveLength(4);
    expect(api.seen).toHaveLength(0);
  });

  // In `vp dev`, ASSETS is a Node handler and an upgrade sent to it exits the dev server (noSocket in index.ts).
  test("answers a WebSocket upgrade outside /api with a 404, never the assets", async () => {
    const { api, assets, env } = bindings();
    for (const path of ["/", "/sync/demo", "/incidents/42"]) {
      const response = await handle(
        new Request(`http://web.test${path}`, { headers: { Upgrade: "websocket" } }),
        env,
      );
      expect(response.status, path).toBe(404);
      expect(await response.json(), path).toEqual({ error: "not_found" });
    }
    expect(assets.seen).toHaveLength(0);
    expect(api.seen).toHaveLength(0);
  });

  test("still forwards a WebSocket upgrade under /api to the API", async () => {
    const { api, assets, env } = bindings();
    await handle(
      new Request("http://web.test/api/sync/demo", { headers: { Upgrade: "websocket" } }),
      env,
    );
    expect(api.seen.map((request) => new URL(request.url).pathname)).toEqual(["/sync/demo"]);
    expect(api.seen[0]?.headers.get("Upgrade")).toBe("websocket");
    expect(assets.seen).toHaveLength(0);
  });
});

/** A body streamed in `chunks`, noting how many the reader asked for (`pulled`). */
function streamed(chunks: string[], fail = false) {
  const state = { pulled: 0 };
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === chunks.length) {
        if (fail) controller.error(new Error("connection reset"));
        else controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[state.pulled++]));
    },
  });
  return { body, state };
}

describe("API call bodies", () => {
  test("a body with a declared length reaches the API as the same bytes, read before it is forwarded", async () => {
    const { env } = bindings();
    const bytes = new Uint8Array([0, 255, 128, 10, 13, 0xc3, 0x28]);
    const received: Uint8Array[] = [];
    const api = upstream(async (request) => {
      received.push(new Uint8Array(await request.arrayBuffer()));
      return new Response(null, { status: 202 });
    });
    const response = await handle(
      new Request("http://web.test/api/alerts/token", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.length),
          "x-signature": "sig",
        },
        body: bytes,
      }),
      { ...env, API: api.binding },
    );
    expect(response.status).toBe(202);
    expect(received).toEqual([bytes]);
    expect(api.seen[0]?.headers.get("x-signature")).toBe("sig");
    expect(new URL(api.seen[0]!.url).pathname).toBe("/alerts/token");
  });

  test("the API answering without reading the body leaves no upload half-sent: it was read in full first", async () => {
    const { env } = bindings();
    const { body, state } = streamed(['{"query":', '"{ __schema }"', "}"]);
    const api = upstream(() => Response.json({ error: "not_found" }, { status: 404 }));
    const request = new Request("http://web.test/api/graphql", {
      method: "POST",
      headers: { "content-length": "26" },
      body,
      duplex: "half",
    } as RequestInit);
    const response = await handle(request, { ...env, API: api.binding });
    expect(response.status).toBe(404);
    expect(state.pulled).toBe(3);
  });

  test("a body with no declared length, or one over the limit, is streamed as before, not read first", async () => {
    const { env } = bindings();
    // One byte over the proxy's `BUFFERED_BODY_MAX` (1 MiB).
    for (const headers of [{}, { "content-length": String(1024 * 1024 + 1) }]) {
      const { body, state } = streamed(["a", "b", "c"]);
      const api = upstream(() => new Response(null, { status: 202 }));
      await handle(
        new Request("http://web.test/api/alerts/token", {
          method: "POST",
          headers,
          body,
          duplex: "half",
        } as RequestInit),
        { ...env, API: api.binding },
      );
      // The API never read it, so neither did the proxy.
      expect(state.pulled, JSON.stringify(headers)).toBeLessThan(3);
      expect(api.seen).toHaveLength(1);
    }
  });

  test("a negative declared length is streamed, not read first", async () => {
    const { env } = bindings();
    const { body, state } = streamed(["a", "b", "c"]);
    const api = upstream(() => new Response(null, { status: 202 }));
    await handle(
      new Request("http://web.test/api/alerts/token", {
        method: "POST",
        headers: { "content-length": "-1" },
        body,
        duplex: "half",
      } as RequestInit),
      { ...env, API: api.binding },
    );
    expect(state.pulled).toBeLessThan(3);
    expect(api.seen).toHaveLength(1);
  });

  test("the forwarded length is the length of the bytes read", async () => {
    const { env } = bindings();
    const api = upstream(() => new Response(null, { status: 202 }));
    await handle(
      new Request("http://web.test/api/alerts/token", {
        method: "POST",
        headers: { "content-length": "7" },
        body: '{"a":1}',
      }),
      { ...env, API: api.binding },
    );
    expect(api.seen[0]?.headers.get("content-length")).toBe("7");
    expect(await api.seen[0]?.text()).toBe('{"a":1}');
  });

  test("an upload that breaks off while it is read is a 400, forwarded to nobody", async () => {
    const { env } = bindings();
    const { body } = streamed(['{"a":'], true);
    const api = upstream(() => new Response(null, { status: 202 }));
    const response = await handle(
      new Request("http://web.test/api/alerts/token", {
        method: "POST",
        headers: { "content-length": "20" },
        body,
        duplex: "half",
      } as RequestInit),
      { ...env, API: api.binding },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_request" });
    expect(api.seen).toHaveLength(0);
  });
});

describe("status page routing", () => {
  test("forwards /status/* to the API unchanged, never the SPA", async () => {
    const { api, assets, env } = bindings();
    const response = await handle(new Request("http://web.test/status/acme"), env);
    expect(await response.json()).toEqual({ path: "/status/acme" });
    expect(api.seen[0]?.url).toBe("http://web.test/status/acme");
    expect(assets.seen).toHaveLength(0);
  });

  test("/status alone goes to the API too (its 404 page), and /statuses stays the SPA's", async () => {
    const { api, assets, env } = bindings();
    await handle(new Request("http://web.test/status"), env);
    expect(api.seen[0]?.url).toBe("http://web.test/status");
    await handle(new Request("http://web.test/statuses"), env);
    expect(api.seen).toHaveLength(1);
    expect(assets.seen).toHaveLength(1);
  });
});

describe("Slack routing", () => {
  test("forwards /slack/* to the Slack binding unchanged: path, method, headers and the signed body", async () => {
    const { api, assets, env } = bindings();
    const slack = upstream(async (request) => Response.json({ body: await request.text() }));
    const request = new Request("http://web.test/slack/commands", {
      method: "POST",
      headers: { "X-Slack-Signature": "v0=test" },
      body: "text=declare+x",
    });
    const response = await handle(request, { ...env, SLACK: slack.binding });
    expect(await response.json()).toEqual({ body: "text=declare+x" });
    expect(slack.seen[0]?.url).toBe("http://web.test/slack/commands");
    expect(slack.seen[0]?.headers.get("X-Slack-Signature")).toBe("v0=test");
    expect(api.seen).toHaveLength(0);
    expect(assets.seen).toHaveLength(0);
  });

  test("without a Slack binding, /slack/* is a 404, not the SPA", async () => {
    const { assets, env } = bindings();
    const response = await handle(new Request("http://web.test/slack/install?state=x"), env);
    expect(response.status).toBe(404);
    expect(assets.seen).toHaveLength(0);
  });

  test("answers the API reference itself, without auth or the API", async () => {
    const { api, assets, env } = bindings();
    const response = await handle(new Request("http://web.test/api/openapi.json"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toMatchObject({ openapi: "3.1.0" });
    const post = await handle(
      new Request("http://web.test/api/openapi.json", { method: "POST" }),
      env,
    );
    expect(post.status).toBe(405);
    expect(api.seen).toHaveLength(0);
    expect(assets.seen).toHaveLength(0);
  });
});
