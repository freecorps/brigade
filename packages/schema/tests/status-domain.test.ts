// A status page's own domain (RFC 0012 "Custom domains"): server-only mutations, each with its event.
import { describe, expect, test } from "vite-plus/test";
import {
  ACCOUNT_ACTOR,
  createMemoryStore,
  isStatusHostname,
  mutations,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  TABLES,
  type BrigadeTables,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 27, 12);
const ctx = (role: Role = "owner", now = T): MutationContext => ({
  actor: { kind: "user", id: `usr_${role}`, role },
  now,
  server: true,
});
type Store = ReturnType<typeof createMemoryStore<BrigadeTables>>;
const run = (store: Store, name: string, args: unknown, context = ctx()) =>
  runMutation(serverMutations, name, args, store, context);

const added = {
  hostname: "status.acme.test",
  cloudflareId: "cfh-1",
  state: "pending",
  records: [{ type: "CNAME", name: "status.acme.test", value: "status-origin.saas.test" }],
  error: null,
};

function ready() {
  const store = createMemoryStore<BrigadeTables>();
  run(store, "statusPage.configure", { slug: "acme", title: "Acme", locale: "en", enabled: true });
  return store;
}

describe("status page domains", () => {
  test("server only, owners and admins; synced so the dashboard shows it", () => {
    expect(Object.keys(mutations)).not.toContain("statusDomain.add");
    expect(Object.keys(serverMutations)).toEqual(
      expect.arrayContaining(["statusDomain.add", "statusDomain.check", "statusDomain.remove"]),
    );
    expect(TABLES.status_domain.serverOnly).toBe(false);
    const store = ready();
    expect(run(store, "statusDomain.add", added, ctx("responder"))).toMatchObject({
      error: { code: "forbidden" },
    });
    expect(run(createMemoryStore<BrigadeTables>(), "statusDomain.add", added)).toMatchObject({
      error: { code: "not_found" },
    });
  });

  test("added once, checked, removed, each with its event", () => {
    const store = ready();
    expect(run(store, "statusDomain.add", added)).toMatchObject({
      ok: true,
      events: [
        {
          type: "status_domain.added",
          data: { hostname: "status.acme.test", state: "pending" },
        },
      ],
    });
    expect(run(store, "statusDomain.add", { ...added, hostname: "other.acme.test" })).toMatchObject(
      {
        error: { code: "conflict" },
      },
    );
    expect(
      run(store, "statusDomain.check", {
        hostname: added.hostname,
        cloudflareId: added.cloudflareId,
        state: "active",
        records: [],
        error: null,
      }),
    ).toMatchObject({
      events: [{ type: "status_domain.checked", data: { state: "active", previous: "pending" } }],
    });
    expect(runQuery(queries, "statusDomain.get", {}, store, "viewer")).toMatchObject({
      rows: [{ hostname: added.hostname, state: "active" }],
    });
    expect(run(store, "statusDomain.remove", { hostname: "other.acme.test" })).toMatchObject({
      error: { code: "not_found" },
    });
    expect(run(store, "statusDomain.remove", { hostname: added.hostname })).toMatchObject({
      events: [{ type: "status_domain.removed", data: { hostname: added.hostname } }],
    });
    expect(store.scan("status_domain")).toEqual([]);
  });

  test("a check about another Cloudflare hostname (removed and added again meanwhile) changes nothing", () => {
    const store = ready();
    run(store, "statusDomain.add", added);
    const stale = { hostname: added.hostname, state: "active", records: [], error: null };
    expect(run(store, "statusDomain.check", { ...stale, cloudflareId: "cfh-0" })).toMatchObject({
      error: { code: "not_found" },
    });
    expect(store.get("status_domain", "status_domain")).toMatchObject({ state: "pending" });
  });

  test("its state's time moves only with the state", () => {
    const store = ready();
    run(store, "statusDomain.add", added);
    const check = (state: string, now: number) =>
      run(
        store,
        "statusDomain.check",
        { hostname: added.hostname, cloudflareId: "cfh-1", state, records: [], error: null },
        ctx("owner", now),
      );
    check("pending", T + 1000);
    expect(store.get("status_domain", "status_domain")).toMatchObject({
      stateAt: T,
      checkedAt: T + 1000,
    });
    check("failed", T + 2000);
    expect(store.get("status_domain", "status_domain")).toMatchObject({ stateAt: T + 2000 });
  });

  test("released for a takeover only by Brigade, only unverified since before the cutoff", () => {
    const store = ready();
    run(store, "statusDomain.add", added);
    const brigade: MutationContext = { actor: ACCOUNT_ACTOR, now: T + 10, server: true };
    const release = { hostname: added.hostname, cloudflareId: "cfh-1", before: T };
    expect(run(store, "statusDomain.release", release)).toMatchObject({
      error: { code: "forbidden" },
    });
    // In its state since after the cutoff, or another Cloudflare hostname: kept.
    expect(
      run(store, "statusDomain.release", { ...release, before: T - 1 }, brigade),
    ).toMatchObject({ error: { code: "conflict" } });
    expect(
      run(store, "statusDomain.release", { ...release, cloudflareId: "cfh-0" }, brigade),
    ).toMatchObject({ error: { code: "not_found" } });
    // Active: kept, whenever it got there.
    run(store, "statusDomain.check", {
      hostname: added.hostname,
      cloudflareId: "cfh-1",
      state: "active",
      records: [],
      error: null,
    });
    expect(
      run(store, "statusDomain.release", { ...release, before: T + 5 }, brigade),
    ).toMatchObject({ error: { code: "conflict" } });
    run(store, "statusDomain.check", {
      hostname: added.hostname,
      cloudflareId: "cfh-1",
      state: "failed",
      records: [],
      error: "moved",
    });
    expect(
      run(store, "statusDomain.release", { ...release, before: T + 5 }, brigade),
    ).toMatchObject({
      ok: true,
      events: [
        { type: "status_domain.removed", data: { hostname: added.hostname, takenOver: true } },
      ],
    });
    expect(store.scan("status_domain")).toEqual([]);
  });

  test("a dedicated hostname has no Cloudflare id and no records; a check about a Cloudflare one changes nothing", () => {
    const store = ready();
    const dedicated = {
      hostname: "status.acme.test",
      cloudflareId: null,
      state: "pending",
      records: [],
      error: "not_attached",
    };
    expect(run(store, "statusDomain.add", dedicated)).toMatchObject({
      ok: true,
      events: [{ type: "status_domain.added", data: { hostname: "status.acme.test" } }],
    });
    expect(store.get("status_domain", "status_domain")).toMatchObject({
      cloudflareId: null,
      records: [],
      error: "not_attached",
    });
    const checked = { ...dedicated, state: "active", error: null };
    // An answer about a Cloudflare hostname is about another domain than this one.
    expect(run(store, "statusDomain.check", { ...checked, cloudflareId: "cfh-1" })).toMatchObject({
      error: { code: "not_found" },
    });
    // Nor is one about the same hostname added at another time (removed and added again meanwhile).
    expect(run(store, "statusDomain.check", { ...checked, addedAt: T - 1 })).toMatchObject({
      error: { code: "not_found" },
    });
    expect(run(store, "statusDomain.check", { ...checked, addedAt: T })).toMatchObject({
      ok: true,
      events: [{ data: { state: "active", previous: "pending" } }],
    });
    expect(store.get("status_domain", "status_domain")).toMatchObject({
      state: "active",
      error: null,
    });
    // A dedicated hostname has no DNS records to create, added or checked.
    const record = { type: "CNAME", name: "status.acme.test", value: "edge.test" };
    expect(run(ready(), "statusDomain.add", { ...dedicated, records: [record] })).toMatchObject({
      error: { code: "invalid_args" },
    });
    expect(
      run(store, "statusDomain.check", { ...checked, addedAt: T, records: [record] }),
    ).toMatchObject({ error: { code: "invalid_args" } });
    // Removed only as the domain it was read as.
    expect(
      run(store, "statusDomain.remove", { hostname: "status.acme.test", addedAt: T - 1 }),
    ).toMatchObject({ error: { code: "not_found" } });
    expect(
      run(store, "statusDomain.remove", { hostname: "status.acme.test", addedAt: T }),
    ).toMatchObject({ ok: true });
    // An empty id is neither: refused.
    expect(run(ready(), "statusDomain.add", { ...dedicated, cloudflareId: "" })).toMatchObject({
      error: { code: "invalid_args" },
    });
  });

  test("only hostnames: no address, no single label, no bad label", () => {
    expect(isStatusHostname("status.acme.test")).toBe(true);
    expect(isStatusHostname("xn--ls8h.test")).toBe(true);
    for (const bad of ["203.0.113.7", "localhost", "a_b.test", "-a.test", "a..test", "A.test"]) {
      expect(isStatusHostname(bad), bad).toBe(false);
    }
    expect(run(ready(), "statusDomain.add", { ...added, hostname: "203.0.113.7" })).toMatchObject({
      error: { code: "invalid_args" },
    });
  });
});
