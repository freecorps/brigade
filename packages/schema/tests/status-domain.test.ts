// A status page's own domain (RFC 0012 "Custom domains"): server-only mutations, each with its event.
import { describe, expect, test } from "vite-plus/test";
import {
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
  hostname: "status.acme.example",
  cloudflareId: "cfh-1",
  state: "pending",
  records: [{ type: "CNAME", name: "status.acme.example", value: "status-origin.example.net" }],
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
          data: { hostname: "status.acme.example", state: "pending" },
        },
      ],
    });
    expect(
      run(store, "statusDomain.add", { ...added, hostname: "other.acme.example" }),
    ).toMatchObject({
      error: { code: "conflict" },
    });
    expect(
      run(store, "statusDomain.check", {
        hostname: added.hostname,
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
    expect(run(store, "statusDomain.remove", { hostname: "other.acme.example" })).toMatchObject({
      error: { code: "not_found" },
    });
    expect(run(store, "statusDomain.remove", { hostname: added.hostname })).toMatchObject({
      events: [{ type: "status_domain.removed", data: { hostname: added.hostname } }],
    });
    expect(store.scan("status_domain")).toEqual([]);
  });

  test("only hostnames: no address, no single label, no bad label", () => {
    expect(isStatusHostname("status.acme.example")).toBe(true);
    expect(isStatusHostname("xn--ls8h.example")).toBe(true);
    for (const bad of [
      "203.0.113.7",
      "localhost",
      "a_b.example",
      "-a.example",
      "a..example",
      "A.example",
    ]) {
      expect(isStatusHostname(bad), bad).toBe(false);
    }
    expect(run(ready(), "statusDomain.add", { ...added, hostname: "203.0.113.7" })).toMatchObject({
      error: { code: "invalid_args" },
    });
  });
});
