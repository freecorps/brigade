import { describe, expect, test } from "vite-plus/test";
import {
  apiAnswered,
  check,
  checkStack,
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
    const report = await checkStack(fetcher);
    expect(calls.toSorted()).toEqual(["/api/health", "/api/workspaces/demo"]);
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
    const pending = checkStack(hang, controller.signal);
    controller.abort();
    const report = await pending;
    expect(seen).toHaveLength(2);
    expect(seen.every((signal) => signal?.aborted)).toBe(true);
    // Cancelled, not timed out (the provider drops the result anyway).
    expect(report.health).toMatchObject({ ok: false, reason: "network" });
  });

  test("tells an API that answered with an error from one that is not there", () => {
    expect(apiAnswered({ ok: true, ms: 1, data: true })).toBe(true);
    expect(apiAnswered({ ok: false, ms: 1, reason: "http", status: 500 })).toBe(true);
    expect(apiAnswered({ ok: false, ms: 1, reason: "invalid" })).toBe(true);
    for (const reason of ["network", "timeout", "unreachable"] as const) {
      expect(apiAnswered({ ok: false, ms: 1, reason }), reason).toBe(false);
    }
  });
});
