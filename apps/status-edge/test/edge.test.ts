// The status page edge (RFC 0012 "Custom domains"): a hostname's lookup in KV, then the API's `StatusPages`; a miss is
// a static 404 counted against the caller, a KV failure a 503 page. Fakes for KV, the limiter and the API.
import { describe, expect, test } from "vite-plus/test";
import type { StatusHost, StatusPagesApi } from "../src/api.ts";
import { HOST_CACHE_TTL_S, serveEdge } from "../src/edge.ts";
import type { EdgeEnv } from "../src/index.ts";

const WORKSPACE = "ws_01JABCDEFGHJKMNPQRSTVWXYZ0";
const HOST = "status.acme.test";

function edge(
  lookups: Record<string, unknown>,
  options: { kvFails?: boolean; limit?: number } = {},
) {
  const reads: { key: string; options: unknown }[] = [];
  const served: { url: string; host: StatusHost; origin: string | null }[] = [];
  const counted: string[] = [];
  const kvFails = options.kvFails === true;
  const api: StatusPagesApi = {
    async serve(request, host) {
      served.push({ url: request.url, host, origin: request.headers.get("Origin") });
      return new Response("the page", { status: 200 });
    },
  };
  const env = {
    STATUS: {
      async get(key: string, options: unknown) {
        reads.push({ key, options });
        if (kvFails) throw new Error("KV is down");
        return lookups[key] ?? null;
      },
    },
    STATUS_MISS_LIMIT: {
      async limit({ key }: { key: string }) {
        counted.push(key);
        return { success: counted.filter((one) => one === key).length <= (options.limit ?? 30) };
      },
    },
    API: api,
  } as unknown as EdgeEnv;
  const visit = (
    path: string,
    init: Omit<RequestInit, "headers"> & { ip?: string; headers?: Record<string, string> } = {},
  ) =>
    serveEdge(
      new Request(`https://${HOST}${path}`, {
        ...init,
        headers: { "cf-connecting-ip": init.ip ?? "203.0.113.9", ...init.headers },
      }),
      env,
    );
  return { env, reads, served, counted, visit };
}

describe("a hostname with a page", () => {
  test("hands the visitor's own request, Origin and all, to the API with the page it found", async () => {
    const { visit, served, reads, counted } = edge({
      [`host:${HOST}`]: { workspaceId: WORKSPACE, slug: "acme" },
    });
    const page = await visit("/status/acme/subscribe", {
      method: "POST",
      headers: { Origin: `https://${HOST}` },
      body: "email=visitor%40example.com",
    });
    expect([page.status, await page.text()]).toEqual([200, "the page"]);
    expect(served).toEqual([
      {
        url: `https://${HOST}/status/acme/subscribe`,
        host: { workspaceId: WORKSPACE, slug: "acme" },
        origin: `https://${HOST}`,
      },
    ]);
    expect(reads).toEqual([
      { key: `host:${HOST}`, options: { type: "json", cacheTtl: HOST_CACHE_TTL_S } },
    ]);
    expect(counted).toEqual([]);
  });

  test("the API failing is the 503 page", async () => {
    const { env, visit } = edge({ [`host:${HOST}`]: { workspaceId: WORKSPACE, slug: "acme" } });
    env.API.serve = async () => {
      throw new Error("the API is down");
    };
    const answer = await visit("/");
    expect(answer.status).toBe(503);
    expect(answer.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("a hostname with no page", () => {
  test("is a static 404 that counts against the caller, then 429", async () => {
    const { visit, served, counted } = edge({}, { limit: 2 });
    const first = await visit("/");
    expect(first.status).toBe(404);
    expect(first.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await first.text()).toContain("No status page here");
    expect((await visit("/x")).status).toBe(404);
    const limited = await visit("/y");
    expect([limited.status, limited.headers.get("Retry-After")]).toEqual([429, "60"]);
    // Another caller is not held back by the first.
    expect((await visit("/", { ip: "198.51.100.4" })).status).toBe(404);
    expect(counted).toEqual(["203.0.113.9", "203.0.113.9", "203.0.113.9", "198.51.100.4"]);
    expect(served).toEqual([]);
  });

  test("a lookup it cannot read is a miss too", async () => {
    const { visit, served } = edge({
      [`host:${HOST}`]: { workspaceId: "not-a-workspace", slug: "acme" },
    });
    expect((await visit("/")).status).toBe(404);
    const bad = edge({ [`host:${HOST}`]: { workspaceId: WORKSPACE, slug: "../admin" } });
    expect((await bad.visit("/")).status).toBe(404);
    expect([...served, ...bad.served]).toEqual([]);
  });

  test("/favicon.ico and /robots.txt are a 404 that never counts, nor reads KV", async () => {
    const { visit, counted, reads } = edge({}, { limit: 0 });
    for (const path of ["/favicon.ico", "/robots.txt"]) {
      expect((await visit(path)).status, path).toBe(404);
    }
    expect(counted).toEqual([]);
    expect(reads).toEqual([]);
  });
});

test("KV failing is the 503 page, never cached, and counts nobody", async () => {
  const { visit, counted, served } = edge({}, { kvFails: true });
  const answer = await visit("/");
  expect(answer.status).toBe(503);
  expect(answer.headers.get("Cache-Control")).toBe("no-store");
  expect(await answer.text()).toContain("Status page unavailable");
  expect(counted).toEqual([]);
  expect(served).toEqual([]);
});
