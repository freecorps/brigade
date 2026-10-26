import { describe, expect, test } from "vite-plus/test";
import {
  check,
  checkStack,
  healthFault,
  parseHealth,
  parseWorkspace,
  verdict,
} from "../src/lib/stack.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe("stack check", () => {
  test("parses the API's health and workspace bodies strictly", () => {
    expect(parseHealth({ ok: true })).toBe(true);
    expect(parseHealth({ ok: "yes" })).toBeUndefined();
    expect(parseWorkspace({ workspace: "demo", tables: 0, databaseSize: 8192 })).toEqual({
      workspace: "demo",
      tables: 0,
      databaseSize: 8192,
    });
    expect(parseWorkspace({ workspace: "demo", tables: -1, databaseSize: 1 })).toBeUndefined();
    expect(parseWorkspace({ workspace: "demo", tables: 1.5, databaseSize: 1 })).toBeUndefined();
    expect(parseWorkspace(null)).toBeUndefined();
  });

  test("reports network, HTTP and shape failures apart", async () => {
    const offline: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await check(offline, "/api/health", parseHealth)).toMatchObject({
      ok: false,
      reason: "network",
    });
    const unavailable: typeof fetch = () => Promise.resolve(json({ error: "unavailable" }, 503));
    expect(await check(unavailable, "/x", parseHealth)).toMatchObject({
      ok: false,
      reason: "http",
      status: 503,
    });
    const gateway: typeof fetch = () => Promise.resolve(json({ error: "api_unreachable" }, 502));
    expect(await check(gateway, "/x", parseHealth)).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
    const otherGateway: typeof fetch = () =>
      Promise.resolve(new Response("Bad Gateway", { status: 502 }));
    expect(await check(otherGateway, "/x", parseHealth)).toMatchObject({
      ok: false,
      reason: "http",
      status: 502,
    });
    const html: typeof fetch = () => Promise.resolve(new Response("<!doctype html>"));
    expect(await check(html, "/x", parseHealth)).toMatchObject({ ok: false, reason: "invalid" });
  });

  test("reports a timeout when the request outlives its deadline", async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("", "TimeoutError")));
      });
    expect(await check(hang, "/x", parseHealth, { timeoutMs: 10 })).toMatchObject({
      ok: false,
      reason: "timeout",
    });
  });

  test("calls both routes through /api and derives the verdict", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = (input) => {
      const path = input instanceof Request ? input.url : input.toString();
      calls.push(path);
      return Promise.resolve(
        path === "/api/health" ? json({ ok: true }) : json({ error: "internal" }, 500),
      );
    };
    const report = await checkStack("ws_01J00000000000000000000000", fetcher);
    expect(calls.toSorted()).toEqual([
      "/api/health",
      "/api/workspaces/ws_01J00000000000000000000000",
    ]);
    expect(verdict(report)).toBe("do-down");
    expect(verdict({ ...report, health: { ok: false, ms: 1, reason: "network" } })).toBe(
      "api-down",
    );
    const workspace = { workspace: "demo", tables: 0, databaseSize: 0 };
    expect(verdict({ ...report, workspace: { ok: true, ms: 1, data: workspace } })).toBe("ok");
  });

  test("an aborted check cancels its requests", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const hang: typeof fetch = (_input, init) => {
      seen.push(init?.signal);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
      });
    };
    const controller = new AbortController();
    const pending = checkStack("ws_01J00000000000000000000000", hang, controller.signal);
    controller.abort();
    const report = await pending;
    expect(seen).toHaveLength(2);
    expect(seen.every((signal) => signal?.aborted)).toBe(true);
    // Cancelled, not timed out (the provider drops the result anyway).
    expect(report.health).toMatchObject({ ok: false, reason: "network" });
  });

  test("classifies a failed /health for the hint", () => {
    expect(healthFault({ ok: true, ms: 1, data: true })).toBeUndefined();
    expect(healthFault({ ok: false, ms: 1, reason: "http", status: 500 })).toBe("erroring");
    expect(healthFault({ ok: false, ms: 1, reason: "invalid" })).toBe("erroring");
    expect(healthFault({ ok: false, ms: 1, reason: "timeout" })).toBe("stuck");
    for (const reason of ["network", "unreachable"] as const) {
      expect(healthFault({ ok: false, ms: 1, reason }), reason).toBe("down");
    }
  });

  test("reports a timeout when the deadline passes while the body streams in", async () => {
    // Headers arrive at once; the body sends one chunk and never closes.
    const stalled: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"ok":'));
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    expect(await check(stalled, "/x", parseHealth, { timeoutMs: 20 })).toMatchObject({
      ok: false,
      reason: "timeout",
    });
    // The same for an error status whose body stalls: still a timeout, not an HTTP error.
    const stalledError: typeof fetch = () =>
      Promise.resolve(new Response(new ReadableStream({ start() {} }), { status: 500 }));
    expect(await check(stalledError, "/x", parseHealth, { timeoutMs: 20 })).toMatchObject({
      reason: "timeout",
    });
  });
});
