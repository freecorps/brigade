// The shard's re-check of a status page's own domain (RFC 0012 "Custom domains"), alone: `DomainChecker` with a fake
// shard, storage, limiter and Cloudflare, for what the shard-level tests cannot reach: the alarm's rate limit, the
// backoff's cap, and an answer about a hostname that was removed or added again while Cloudflare answered. Then what
// reaching the edge at a dedicated hostname makes of each answer.
import { STATUS_DOMAIN_ID, type StatusDomainRow } from "@freecorps/brigade-schema";
import { EDGE_HEADER } from "@freecorps/brigade-status-edge/api";
import { describe, expect, test } from "vite-plus/test";
import type { Shard } from "../src/shard.ts";
import type { SaasConfig } from "../src/status-domain-cf.ts";
import { EDGE_MISSES_MAX, edgeAnswers, probedState } from "../src/status-domain-edge.ts";
import {
  DOMAIN_ACTIVE_RECHECK_MS,
  DOMAIN_RECHECK_MAX_MS,
  DOMAIN_PENDING_MAX_MS,
  DOMAIN_RECHECK_MIN_MS,
  domainCheckDue,
  DomainChecker,
} from "../src/status-domain-check.ts";

const T = Date.UTC(2026, 9, 27, 12);
const CONFIG: SaasConfig = {
  token: "test-saas-token",
  zoneId: "zone-test",
  target: "origin.saas.test",
};
const ROW: StatusDomainRow = {
  id: STATUS_DOMAIN_ID,
  hostname: "status.acme.test",
  cloudflareId: "cfh-1",
  state: "pending",
  records: [],
  error: null,
  checkedAt: T,
  stateAt: T,
  createdAt: T,
  createdBy: "usr_ana",
};

/** `shard_meta` as the checker reads and writes it. */
function fakeSql() {
  const meta = new Map<string, number>();
  const exec = (query: string, ...params: unknown[]) => {
    const rows: { value: number }[] = [];
    if (query.startsWith("select")) {
      const value = meta.get(params[0] as string);
      if (value !== undefined) rows.push({ value });
    } else if (query.startsWith("insert")) meta.set(params[0] as string, params[1] as number);
    else if (query.startsWith("delete")) meta.delete(params[0] as string);
    return { toArray: () => rows };
  };
  return { meta, sql: { exec } as unknown as SqlStorage };
}

/** Cloudflare's answer for a pending hostname. */
const pending = () =>
  Response.json({
    success: true,
    errors: [],
    result: {
      id: "cfh-1",
      hostname: ROW.hostname,
      status: "pending",
      ssl: { status: "pending_validation", method: "http", type: "dv" },
    },
  });

function setup(
  options: { allowed?: boolean; send?: (request: Request) => Promise<Response> } = {},
) {
  let row: StatusDomainRow | undefined = { ...ROW };
  const { meta, sql } = fakeSql();
  const sent: string[] = [];
  const checks: Record<string, unknown>[] = [];
  const limited: string[] = [];
  const checker = new DomainChecker({
    shard: {
      store: { get: (table: string) => (table === "status_domain" ? row : undefined) },
    } as unknown as Shard,
    sql,
    config: () => CONFIG,
    limiter: () =>
      ({
        limit: async ({ key }: { key: string }) => {
          limited.push(key);
          return { success: options.allowed ?? true };
        },
      }) as RateLimit,
    send: async (request) => {
      sent.push(`${request.method} ${new URL(request.url).pathname.split("/").pop()}`);
      return (options.send ?? (async () => pending()))(request);
    },
    check: (args) => checks.push(args),
    log: () => {},
  });
  return {
    checker,
    meta,
    sent,
    checks,
    limited,
    set: (next: StatusDomainRow | undefined) => {
      row = next;
    },
  };
}

describe("the shard's domain checker", () => {
  test("past the workspace's limit Cloudflare is not asked, and the check backs off", async () => {
    const { checker, sent, checks, limited } = setup({ allowed: false });
    const due = T + DOMAIN_RECHECK_MIN_MS;
    await checker.run("ws_test", due);
    expect(limited).toEqual(["ws_test"]);
    expect(sent).toEqual([]);
    expect(checks).toEqual([]);
    expect(checker.nextAt(due)).toBe(due + DOMAIN_RECHECK_MIN_MS);
  });

  test("failures back off from a minute, doubling, never past an hour", async () => {
    const { checker, meta } = setup({
      send: async () => new Response("bad gateway", { status: 502 }),
    });
    let at = T + DOMAIN_RECHECK_MIN_MS;
    const steps: number[] = [];
    for (let attempt = 0; attempt < 9; attempt++) {
      await checker.run("ws_test", at);
      const next = meta.get("domain_retry_at")!;
      steps.push(next - at);
      at = next;
    }
    expect(steps.map((step) => step / DOMAIN_RECHECK_MIN_MS)).toEqual([
      1, 2, 4, 8, 16, 32, 60, 60, 60,
    ]);
    expect(Math.max(...steps)).toBe(DOMAIN_RECHECK_MAX_MS);
  });

  test("an answer about a hostname removed, or removed and added again, while Cloudflare answered is dropped", async () => {
    for (const next of [undefined, { ...ROW, cloudflareId: "cfh-2" }]) {
      const context = setup({
        send: async () => {
          context.set(next);
          return pending();
        },
      });
      await context.checker.run("ws_test", T + DOMAIN_RECHECK_MIN_MS);
      expect(context.sent).toEqual(["GET cfh-1"]);
      expect(context.checks).toEqual([]);
    }
    // The same hostname still: recorded, with the Cloudflare hostname it was about.
    const { checker, checks } = setup();
    await checker.run("ws_test", T + DOMAIN_RECHECK_MIN_MS);
    expect(checks).toMatchObject([
      { hostname: ROW.hostname, cloudflareId: "cfh-1", state: "pending", error: null },
    ]);
  });
});

describe("domainCheckDue", () => {
  test("the 7 days count from when it became pending, so an old domain that turns pending is still asked about", () => {
    const old = T - 30 * 24 * 60 * 60 * 1000;
    // Added a month ago, active until a check just now found it pending (a certificate renewal).
    const renewing = { ...ROW, createdAt: old, stateAt: T, checkedAt: T };
    expect(domainCheckDue(renewing, T + 1000)).toBe(T + DOMAIN_RECHECK_MIN_MS);
    // Pending since it was added, a week and more ago: no longer asked about on its own.
    const stale = { ...ROW, createdAt: old, stateAt: old, checkedAt: T };
    expect(domainCheckDue(stale, old + DOMAIN_PENDING_MAX_MS + 1)).toBeNull();
  });
});

describe("the edge at a dedicated hostname", () => {
  const answer = (status: number, edge: boolean) => async () =>
    new Response("", { status, headers: edge ? { [EDGE_HEADER]: "1" } : {} });

  test("only the edge's own header says it answers there; anything else, or nothing, does not", async () => {
    expect(await edgeAnswers("status.acme.test", answer(404, true))).toBe(true);
    // The edge's own 503 page is still the edge.
    expect(await edgeAnswers("status.acme.test", answer(503, true))).toBe(true);
    // Another site, a redirect (not followed), a WAF rule, Cloudflare's own error page.
    for (const status of [200, 301, 403, 530]) {
      expect(await edgeAnswers("status.acme.test", answer(status, false)), String(status)).toBe(
        false,
      );
    }
    expect(
      await edgeAnswers("status.acme.test", async () => {
        throw new TypeError("Network connection lost.");
      }),
    ).toBe(false);
  });

  test("an active domain is never set back by one answer; anything else waits for the edge, and never fails", () => {
    expect(probedState("active", false)).toBeNull();
    expect(probedState("active", true)).toEqual({ state: "active", error: null });
    for (const current of [null, "pending"] as const) {
      expect(probedState(current, false)).toEqual({ state: "pending", error: "not_attached" });
      expect(probedState(current, true)).toEqual({ state: "active", error: null });
    }
  });

  test("an active domain goes back to pending only after the edge missed EDGE_MISSES_MAX checks in a row", async () => {
    const reached: string[] = [];
    let attached = false;
    const row: StatusDomainRow = { ...ROW, cloudflareId: null, state: "active" };
    const checks: Record<string, unknown>[] = [];
    const { meta, sql } = fakeSql();
    const checker = new DomainChecker({
      shard: {
        store: { get: (table: string) => (table === "status_domain" ? row : undefined) },
      } as unknown as Shard,
      sql,
      config: () => undefined,
      limiter: () => undefined,
      send: async (request) => {
        reached.push(request.url);
        return answer(attached ? 404 : 403, attached)();
      },
      check: (args) => checks.push(args),
      log: () => {},
    });
    // A miss, then the edge answers again: the count starts over.
    let at = T + DOMAIN_ACTIVE_RECHECK_MS;
    await checker.run("ws_1", at);
    expect(meta.get("domain_misses")).toBe(1);
    attached = true;
    at = checker.nextAt(at)!;
    await checker.run("ws_1", at);
    expect(checks).toMatchObject([{ state: "active" }]);
    expect(meta.get("domain_misses")).toBeUndefined();
    // Then never again: backed off like a failure, nothing recorded until the last miss.
    attached = false;
    checks.length = 0;
    for (let miss = 1; miss < EDGE_MISSES_MAX; miss++) {
      await checker.run("ws_1", at);
      expect(checks, `miss ${miss}`).toEqual([]);
      expect(meta.get("domain_misses")).toBe(miss);
      at = checker.nextAt(at)!;
    }
    await checker.run("ws_1", at);
    expect(checks).toEqual([
      {
        hostname: "status.acme.test",
        cloudflareId: null,
        state: "pending",
        records: [],
        error: "not_attached",
      },
    ]);
    expect(meta.get("domain_misses")).toBeUndefined();
    expect(reached).toHaveLength(EDGE_MISSES_MAX + 2);
  });

  test("checked with no Cloudflare settings; an answer about another dedicated hostname is dropped", async () => {
    const reached: string[] = [];
    let row: StatusDomainRow | undefined = { ...ROW, cloudflareId: null };
    const checks: Record<string, unknown>[] = [];
    const checker = new DomainChecker({
      shard: {
        store: { get: (table: string) => (table === "status_domain" ? row : undefined) },
      } as unknown as Shard,
      sql: fakeSql().sql,
      config: () => undefined,
      limiter: () => undefined,
      send: async (request) => {
        reached.push(request.url);
        // Removed and another dedicated hostname added while the edge answered.
        if (reached.length === 2) row = { ...ROW, cloudflareId: null, hostname: "other.acme.test" };
        return answer(404, true)();
      },
      check: (args) => checks.push(args),
      log: () => {},
    });
    expect(checker.nextAt(T)).toBe(T + DOMAIN_RECHECK_MIN_MS);
    await checker.run("ws_1", T + DOMAIN_RECHECK_MIN_MS);
    expect(reached).toEqual(["https://status.acme.test/robots.txt"]);
    expect(checks).toEqual([
      {
        hostname: "status.acme.test",
        cloudflareId: null,
        state: "active",
        records: [],
        error: null,
      },
    ]);
    await checker.run("ws_1", T + DOMAIN_RECHECK_MAX_MS);
    expect(checks).toHaveLength(1);
  });
});
