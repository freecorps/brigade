// The shard's re-check of a status page's own domain (RFC 0012 "Custom domains"), alone: `DomainChecker` with a fake
// shard, storage, limiter and Cloudflare, for what the shard-level tests cannot reach: the alarm's rate limit, the
// backoff's cap, and an answer about a hostname that was removed or added again while Cloudflare answered.
import { STATUS_DOMAIN_ID, type StatusDomainRow } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import type { Shard } from "../src/shard.ts";
import type { SaasConfig } from "../src/status-domain-cf.ts";
import {
  DOMAIN_RECHECK_MAX_MS,
  DOMAIN_RECHECK_MIN_MS,
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
