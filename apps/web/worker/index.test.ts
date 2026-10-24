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
});
