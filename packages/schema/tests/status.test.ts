import { describe, expect, test } from "vite-plus/test";
import {
  componentsForServices,
  componentStatus,
  createMemoryStore,
  MAX_COMPONENT_SERVICES,
  isStatusSlug,
  MAX_COMPONENTS,
  MAX_PUBLIC_UPDATES,
  mutations,
  newId,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  STATUS_PAGE_ID,
  statusAudience,
  statusFollowKey,
  STATUS_FOLLOW_KEY,
  statusSnapshot,
  TABLES,
  type BrigadeTables,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 27, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const random = (n: number) => new Uint8Array(n).fill(7);

const ctx = (role: Role = "owner", now = T, server = true): MutationContext => ({
  actor: { kind: "user", id: `usr_${role}`, role },
  now,
  server,
});

const page = { slug: "acme", title: "Acme", locale: "pt-BR", enabled: true };

type Store = ReturnType<typeof createMemoryStore<BrigadeTables>>;

function run(store: Store, name: string, args: unknown, context = ctx()) {
  return runMutation(serverMutations, name, args, store, context);
}

function ready(): { store: Store; incident: string; api: string; web: string } {
  const store = createMemoryStore<BrigadeTables>();
  expect(run(store, "statusPage.configure", page)).toMatchObject({ ok: true });
  const incident = newId("inc", T, random);
  expect(
    run(store, "incident.declare", { id: incident, title: "db primary OOM", severity: "sev1" }),
  ).toMatchObject({ ok: true });
  const api = newId("cmp", T, () => new Uint8Array(10).fill(1));
  const web = newId("cmp", T + 1, () => new Uint8Array(10).fill(2));
  expect(run(store, "statusComponent.create", { id: api, name: "API", group: null })).toMatchObject(
    { ok: true },
  );
  expect(
    run(
      store,
      "statusComponent.create",
      { id: web, name: "Website", group: "Apps" },
      ctx("admin", T + 1),
    ),
  ).toMatchObject({ ok: true });
  return { store, incident, api, web };
}

const publish = (incident: string, extra: Record<string, unknown> = {}) => ({
  id: incident,
  title: "Slow API responses",
  status: "investigating",
  impact: "partial_outage",
  componentIds: [],
  body: "We're looking into slow responses.",
  ...extra,
});

describe("statusPage.configure", () => {
  test("is server only: the API claims the slug in D1 first", () => {
    expect(Object.keys(mutations)).not.toContain("statusPage.configure");
    expect(Object.keys(serverMutations)).toContain("statusPage.configure");
    expect(TABLES.status_retired.serverOnly).toBe(true);
  });

  test("owners and admins set it up; responders and viewers cannot", () => {
    for (const role of ["responder", "viewer"] as const) {
      const store = createMemoryStore<BrigadeTables>();
      expect(run(store, "statusPage.configure", page, ctx(role))).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
    const store = createMemoryStore<BrigadeTables>();
    const result = run(store, "statusPage.configure", page, ctx("admin"));
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "status_page.configured",
          subject: STATUS_PAGE_ID,
          data: { ...page, previousSlug: null },
        },
      ],
    });
    expect(store.get("status_page", STATUS_PAGE_ID)).toMatchObject({
      ...page,
      updatedBy: "usr_admin",
    });
  });

  test("no change is a conflict", () => {
    const { store } = ready();
    expect(run(store, "statusPage.configure", page)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });

  test("a new slug retires the old one, and taking it back un-retires it", () => {
    const { store } = ready();
    const moved = run(store, "statusPage.configure", { ...page, slug: "acme-status" });
    expect(moved).toMatchObject({ ok: true, events: [{ data: { previousSlug: "acme" } }] });
    expect(store.scan("status_retired").map((row) => row.id)).toEqual(["acme"]);
    run(store, "statusPage.configure", { ...page, slug: "acme" });
    expect(store.scan("status_retired").map((row) => row.id)).toEqual(["acme-status"]);
  });

  test("a draft taking back the slug it just left holds it, so moving on retires it again", () => {
    const { store } = ready();
    run(store, "statusPage.configure", { ...page, enabled: false, slug: "acme-draft" });
    expect(store.scan("status_retired").map((row) => row.id)).toEqual(["acme"]);
    // Back to "acme" before the shard released it: still this workspace's in D1 and KV.
    run(store, "statusPage.configure", { ...page, enabled: false, slug: "acme" });
    expect(store.get("status_page", STATUS_PAGE_ID)).toMatchObject({ claimed: true });
    run(store, "statusPage.configure", { ...page, enabled: false, slug: "acme-later" });
    expect(store.scan("status_retired").map((row) => row.id)).toContain("acme");
  });

  test("slugs are 3 to 40 lowercase letters, digits and single inner hyphens", () => {
    for (const ok of ["abc", "acme-status", "a1-b2-c3", "x".repeat(40)]) {
      expect(isStatusSlug(ok), ok).toBe(true);
    }
    for (const bad of [
      "ab",
      "-acme",
      "acme-",
      "ac--me",
      "Acme",
      "acme status",
      "x".repeat(41),
      "acmé",
    ]) {
      expect(isStatusSlug(bad), bad).toBe(false);
      const store = createMemoryStore<BrigadeTables>();
      expect(run(store, "statusPage.configure", { ...page, slug: bad })).toMatchObject({
        ok: false,
        error: { code: "invalid_args" },
      });
    }
  });
});

describe("components", () => {
  test("owners and admins manage them, with events; responders cannot", () => {
    const { store, api } = ready();
    expect(
      runMutation(
        mutations,
        "statusComponent.update",
        { id: api, name: "API", group: null, status: "degraded" },
        store,
        ctx("responder"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const updated = runMutation(
      mutations,
      "statusComponent.update",
      { id: api, name: "Public API", group: "Core", status: "degraded" },
      store,
      ctx("admin"),
    );
    expect(updated).toMatchObject({
      ok: true,
      events: [
        { type: "status_component.updated", data: { name: "Public API", status: "degraded" } },
      ],
    });
  });

  test("at most MAX_COMPONENTS", () => {
    const store = createMemoryStore<BrigadeTables>();
    for (let index = 0; index < MAX_COMPONENTS; index++) {
      const id = newId("cmp", T + index, random);
      expect(
        run(store, "statusComponent.create", { id, name: `C${index}`, group: null }),
      ).toMatchObject({
        ok: true,
      });
    }
    const id = newId("cmp", T + 999, random);
    expect(
      run(store, "statusComponent.create", { id, name: "One more", group: null }),
    ).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
  });

  test("deleting one takes it out of every published incident", () => {
    const { store, incident, api, web } = ready();
    run(
      store,
      "incident.publishUpdate",
      publish(incident, { componentIds: [api, web] }),
      ctx("responder"),
    );
    const deleted = run(store, "statusComponent.delete", { id: api });
    expect(deleted).toMatchObject({
      ok: true,
      events: [{ type: "status_component.deleted", data: { id: api, incidents: 1 } }],
    });
    expect(store.get("status_incidents", incident)?.componentIds).toEqual([web]);
  });
});

describe("statusComponent.reorder", () => {
  const order = (store: Store) =>
    (
      runQuery(queries, "statusComponents.all", {}, store, "viewer") as { rows: { id: string }[] }
    ).rows.map((row) => row.id);

  test("owners and admins set the order, with an event; it moves the page's groups too", () => {
    const { store, api, web } = ready();
    const db = newId("cmp", T + 2, () => new Uint8Array(10).fill(3));
    run(store, "statusComponent.create", { id: db, name: "Database", group: "Core" });
    expect(order(store)).toEqual([api, web, db]);
    expect(
      runMutation(
        mutations,
        "statusComponent.reorder",
        { ids: [db, web, api] },
        store,
        ctx("responder"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      runMutation(
        mutations,
        "statusComponent.reorder",
        { ids: [db, web, api] },
        store,
        ctx("admin"),
      ),
    ).toMatchObject({
      ok: true,
      events: [{ type: "status_component.reordered", data: { ids: [db, web, api] } }],
    });
    expect(order(store)).toEqual([db, web, api]);
    // Groups follow their first component; the ungrouped ones still come first.
    expect(statusSnapshot(store, T)?.groups.map((group) => group.name)).toEqual([
      null,
      "Core",
      "Apps",
    ]);
    // A component added later comes last.
    const cdn = newId("cmp", T + 3, () => new Uint8Array(10).fill(4));
    run(store, "statusComponent.create", { id: cdn, name: "CDN", group: null });
    expect(order(store)).toEqual([db, web, api, cdn]);
  });

  test("components from before reordering keep coming first, oldest first", () => {
    const store = createMemoryStore<BrigadeTables>();
    const legacy = (id: string, name: string, at: number) =>
      store.insert("status_components", {
        id,
        name,
        group: null,
        status: "operational",
        createdAt: at,
        updatedAt: at,
      });
    const api = newId("cmp", T, () => new Uint8Array(10).fill(1));
    const web = newId("cmp", T + 1, () => new Uint8Array(10).fill(2));
    legacy(web, "Website", T + 1);
    legacy(api, "API", T);
    const db = newId("cmp", T + 2, () => new Uint8Array(10).fill(3));
    run(store, "statusComponent.create", { id: db, name: "Database", group: null });
    expect(store.get("status_components", db)?.position).toBe(0);
    expect(order(store)).toEqual([api, web, db]);
  });

  test("a stale or partial order is refused, never dropping a component; the same order is a conflict", () => {
    const { store, api, web } = ready();
    expect(run(store, "statusComponent.reorder", { ids: [web] })).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
    const gone = newId("cmp", T + 9, () => new Uint8Array(10).fill(9));
    expect(run(store, "statusComponent.reorder", { ids: [web, api, gone] })).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "ids[2]" }] },
    });
    expect(run(store, "statusComponent.reorder", { ids: [api, web] })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(order(store)).toEqual([api, web]);
  });

  test("runs optimistically on a client too", () => {
    const { store, api, web } = ready();
    expect(
      runMutation(
        mutations,
        "statusComponent.reorder",
        { ids: [web, api] },
        store,
        ctx("owner", T, false),
      ),
    ).toMatchObject({ ok: true });
    expect(order(store)).toEqual([web, api]);
  });
});

describe("statusComponent.linkServices", () => {
  const SVC = "svc_01JB0000000000000000000001";
  const SVC2 = "svc_01JB0000000000000000000002";
  const service = (id: string, name: string) => ({
    id,
    name,
    description: "",
    tier: "tier1",
    owners: [],
    escalationPolicyId: null,
  });

  test("owners and admins link services, with an event; the incident's services pick the components", () => {
    const { store, api, web } = ready();
    run(store, "service.create", service(SVC, "Checkout"));
    run(store, "service.create", service(SVC2, "Search"));
    expect(
      runMutation(
        mutations,
        "statusComponent.linkServices",
        { id: api, serviceIds: [SVC] },
        store,
        ctx("responder"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      run(store, "statusComponent.linkServices", { id: api, serviceIds: [SVC] }, ctx("admin")),
    ).toMatchObject({
      ok: true,
      events: [{ type: "status_component.services_linked", data: { id: api, serviceIds: [SVC] } }],
    });
    run(store, "statusComponent.linkServices", { id: web, serviceIds: [SVC, SVC2] });
    const components = store.scan("status_components").sort((a, b) => a.createdAt - b.createdAt);
    expect(componentsForServices(components, [SVC2])).toEqual([web]);
    expect(componentsForServices(components, [SVC])).toEqual([api, web]);
    expect(componentsForServices(components, [])).toEqual([]);
    // Nothing about the services reaches the public page.
    const text = JSON.stringify(statusSnapshot(store, T));
    for (const internal of ["svc_", "Checkout", "Search"]) expect(text).not.toContain(internal);
  });

  test("services that exist, at most MAX_COMPONENT_SERVICES; unchanged is a conflict; empty unlinks", () => {
    const { store, api } = ready();
    expect(
      run(store, "statusComponent.linkServices", { id: api, serviceIds: [SVC] }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "serviceIds[0]" }] },
    });
    const many = Array.from({ length: MAX_COMPONENT_SERVICES + 1 }, (_, index) =>
      newId("svc", T + index, random),
    );
    expect(run(store, "statusComponent.linkServices", { id: api, serviceIds: many })).toMatchObject(
      {
        ok: false,
        error: { code: "invalid_args" },
      },
    );
    run(store, "service.create", service(SVC, "Checkout"));
    run(store, "statusComponent.linkServices", { id: api, serviceIds: [SVC] });
    expect(
      run(store, "statusComponent.linkServices", { id: api, serviceIds: [SVC] }),
    ).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(run(store, "statusComponent.linkServices", { id: api, serviceIds: [] })).toMatchObject({
      ok: true,
    });
    expect(store.get("status_components", api)?.serviceIds).toEqual([]);
  });
});

describe("incident.publishUpdate", () => {
  test("responders publish; viewers cannot", () => {
    const { store, incident } = ready();
    expect(run(store, "incident.publishUpdate", publish(incident), ctx("viewer"))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    const result = run(store, "incident.publishUpdate", publish(incident), ctx("responder"));
    expect(result).toMatchObject({
      ok: true,
      events: [
        {
          type: "incident.update_published",
          subject: incident,
          data: { entryId: `${incident}:2`, title: "Slow API responses", status: "investigating" },
        },
      ],
    });
  });

  test("needs a page that is set up, and components that exist", () => {
    const store = createMemoryStore<BrigadeTables>();
    const incident = newId("inc", T, random);
    run(store, "incident.declare", { id: incident, title: "x", severity: "sev2" });
    expect(run(store, "incident.publishUpdate", publish(incident))).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    const { store: other, incident: id } = ready();
    expect(
      run(
        other,
        "incident.publishUpdate",
        publish(id, { componentIds: [newId("cmp", T, random)] }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "componentIds[0]" }] },
    });
  });

  test("writes the public row and a timeline entry, never the internal title", () => {
    const { store, incident, api } = ready();
    run(store, "incident.publishUpdate", publish(incident, { componentIds: [api] }));
    const row = store.get("status_incidents", incident);
    expect(row).toMatchObject({
      title: "Slow API responses",
      status: "investigating",
      impact: "partial_outage",
      componentIds: [api],
      publishedAt: T,
      resolvedAt: null,
    });
    expect(JSON.stringify(row)).not.toContain("db primary OOM");
    expect(store.get("timeline", `${incident}:2`)).toMatchObject({
      kind: "status_published",
      status: "investigating",
      body: "We're looking into slow responses.",
    });
  });

  test("resolved sets resolvedAt once; publishing again reopens", () => {
    const { store, incident } = ready();
    run(store, "incident.publishUpdate", publish(incident));
    run(
      store,
      "incident.publishUpdate",
      publish(incident, { status: "resolved" }),
      ctx("owner", T + 10),
    );
    run(
      store,
      "incident.publishUpdate",
      publish(incident, { status: "resolved", body: "Root cause." }),
      ctx("owner", T + 20),
    );
    expect(store.get("status_incidents", incident)?.resolvedAt).toBe(T + 10);
    run(
      store,
      "incident.publishUpdate",
      publish(incident, { status: "monitoring" }),
      ctx("owner", T + 30),
    );
    expect(store.get("status_incidents", incident)).toMatchObject({
      resolvedAt: null,
      publishedAt: T,
    });
    expect(store.get("status_incidents", incident)?.updates).toHaveLength(4);
  });

  test("at most MAX_PUBLIC_UPDATES per incident", () => {
    const { store, incident } = ready();
    for (let index = 0; index < MAX_PUBLIC_UPDATES; index++) {
      expect(run(store, "incident.publishUpdate", publish(incident))).toMatchObject({ ok: true });
    }
    expect(run(store, "incident.publishUpdate", publish(incident))).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
  });

  test("runs optimistically on a client too", () => {
    const { store, incident } = ready();
    const result = runMutation(
      mutations,
      "incident.publishUpdate",
      publish(incident),
      store,
      ctx("responder", T, false),
    );
    expect(result).toMatchObject({ ok: true });
  });
});

describe("corrections", () => {
  /** An incident with two published updates, the second at T + 1. */
  function twice() {
    const ready_ = ready();
    const { store, incident } = ready_;
    run(store, "incident.publishUpdate", publish(incident), ctx("responder"));
    run(
      store,
      "incident.publishUpdate",
      publish(incident, { status: "identified", body: "Found it: a bad deploy." }),
      ctx("responder", T + 1),
    );
    const [first, second] = store.get("status_incidents", incident)!.updates;
    return { ...ready_, first: first!, second: second! };
  }
  const corrections = (store: Store, incident: string) =>
    store
      .scan("timeline")
      .filter((row) => row.incidentId === incident && row.kind === "status_corrected");

  test("an update's text is corrected in place, with an event and a timeline entry", () => {
    const { store, incident, first } = twice();
    const result = run(
      store,
      "incident.editPublishedUpdate",
      { id: incident, updateId: first.id, body: "We're looking into slow responses on the API." },
      ctx("responder", T + 2),
    );
    expect(result).toMatchObject({
      ok: true,
      events: [
        {
          type: "incident.published_update_edited",
          subject: incident,
          data: { updateId: first.id, body: "We're looking into slow responses on the API." },
        },
      ],
    });
    const row = store.get("status_incidents", incident)!;
    expect(row.updates.map((update) => update.body)).toEqual([
      "We're looking into slow responses on the API.",
      "Found it: a bad deploy.",
    ]);
    // Its time and status stay; so does where the incident stands.
    expect(row.updates[0]).toMatchObject({ at: first.at, status: "investigating" });
    expect(row.status).toBe("identified");
    expect(corrections(store, incident)).toMatchObject([
      {
        change: "edited",
        body: "We're looking into slow responses on the API.",
        actor: "usr_responder",
      },
    ]);
    expect(statusSnapshot(store, T + 3)!.active[0]!.updates.map((update) => update.body)).toEqual([
      "Found it: a bad deploy.",
      "We're looking into slow responses on the API.",
    ]);
    // The same text again changes nothing.
    expect(
      run(store, "incident.editPublishedUpdate", {
        id: incident,
        updateId: first.id,
        body: "We're looking into slow responses on the API.",
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("an update is removed while another is left; the timeline keeps what came down", () => {
    const { store, incident, first, second } = twice();
    expect(
      run(store, "incident.removePublishedUpdate", { id: incident, updateId: second.id }),
    ).toMatchObject({
      ok: true,
      events: [{ type: "incident.published_update_removed", data: { updateId: second.id } }],
    });
    expect(store.get("status_incidents", incident)!.updates.map((update) => update.id)).toEqual([
      first.id,
    ]);
    expect(corrections(store, incident)).toMatchObject([
      { change: "removed", body: "Found it: a bad deploy." },
    ]);
    // The last one cannot go: the incident is taken off instead.
    expect(
      run(store, "incident.removePublishedUpdate", { id: incident, updateId: first.id }),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(
      run(store, "incident.removePublishedUpdate", { id: incident, updateId: `${incident}:99` }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("an incident is taken off the page entirely, and can be published again afresh", () => {
    const { store, incident } = twice();
    expect(run(store, "incident.unpublish", { id: incident }, ctx("admin", T + 5))).toMatchObject({
      ok: true,
      events: [{ type: "incident.unpublished", data: { title: "Slow API responses" } }],
    });
    expect(store.get("status_incidents", incident)).toBeUndefined();
    expect(statusSnapshot(store, T + 6)!.active).toEqual([]);
    expect(corrections(store, incident)).toMatchObject([
      { change: "withdrawn", body: "Slow API responses", actor: "usr_admin" },
    ]);
    expect(run(store, "incident.unpublish", { id: incident })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    run(store, "incident.publishUpdate", publish(incident), ctx("owner", T + 7));
    expect(store.get("status_incidents", incident)).toMatchObject({
      publishedAt: T + 7,
      updates: [expect.objectContaining({ at: T + 7 })],
    });
  });

  test("whoever can publish can correct; viewers cannot; clients run them optimistically", () => {
    const { store, incident, first } = twice();
    const edit = { id: incident, updateId: first.id, body: "Corrected." };
    expect(run(store, "incident.editPublishedUpdate", edit, ctx("viewer"))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(run(store, "incident.unpublish", { id: incident }, ctx("viewer"))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    for (const name of [
      "incident.editPublishedUpdate",
      "incident.removePublishedUpdate",
      "incident.unpublish",
    ]) {
      expect(Object.keys(mutations)).toContain(name);
    }
    expect(
      runMutation(
        mutations,
        "incident.editPublishedUpdate",
        edit,
        store,
        ctx("responder", T, false),
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("statusSnapshot", () => {
  test("none for a page that is missing or not public", () => {
    expect(statusSnapshot(createMemoryStore<BrigadeTables>(), T)).toBeNull();
    const { store } = ready();
    run(store, "statusPage.configure", { ...page, enabled: false });
    expect(statusSnapshot(store, T)).toBeNull();
  });

  test("components grouped, status derived from open incidents, nothing internal", () => {
    const { store, incident, api, web } = ready();
    run(
      store,
      "incident.publishUpdate",
      publish(incident, { componentIds: [api], impact: "major_outage" }),
    );
    const snapshot = statusSnapshot(store, T + 5)!;
    expect(snapshot).toMatchObject({
      v: 1,
      title: "Acme",
      locale: "pt-BR",
      generatedAt: T + 5,
      status: "major_outage",
      groups: [
        { name: null, components: [{ name: "API", status: "major_outage" }] },
        { name: "Apps", components: [{ name: "Website", status: "operational" }] },
      ],
      active: [
        {
          title: "Slow API responses",
          components: ["API"],
          updates: [{ status: "investigating" }],
        },
      ],
      history: [],
    });
    // No uptime bar and no maintenance: a version 1, which a reader rolled back to 1 still renders.
    expect(snapshot).not.toHaveProperty("maintenance");
    expect(snapshot).not.toHaveProperty("upcoming");
    const text = JSON.stringify(snapshot);
    for (const internal of ["db primary OOM", "usr_", incident, api, web, "inc_", "cmp_"]) {
      expect(text).not.toContain(internal);
    }
  });

  test("history keeps 90 days, newest first; a resolved incident stops counting", () => {
    const { store, incident, api } = ready();
    run(
      store,
      "incident.publishUpdate",
      publish(incident, { componentIds: [api], status: "resolved" }),
    );
    expect(statusSnapshot(store, T + DAY)).toMatchObject({
      status: "operational",
      active: [],
      history: [{ status: "resolved", resolvedAt: T }],
    });
    expect(statusSnapshot(store, T + 91 * DAY)?.history).toEqual([]);
  });

  test("the hand-set status counts too", () => {
    expect(componentStatus({ id: "c", status: "degraded" }, [])).toBe("degraded");
    expect(
      componentStatus({ id: "c", status: "degraded" }, [
        { status: "resolved", impact: "major_outage", componentIds: ["c"] },
      ]),
    ).toBe("degraded");
  });

  test("queries read with status:read", () => {
    const { store } = ready();
    expect(runQuery(queries, "statusPage.config", {}, store, "viewer")).toMatchObject({ ok: true });
    expect(runQuery(queries, "statusComponents.all", {}, store, "viewer")).toMatchObject({
      ok: true,
      rows: [{ name: "API" }, { name: "Website" }],
    });
  });
});

describe("following components", () => {
  test("a key is stable, typed and not the id; 50 components and their groups never collide", () => {
    const id = "cmp_01JZ000000000000000000000A";
    expect(statusFollowKey("c", id)).toBe(statusFollowKey("c", id));
    expect(statusFollowKey("c", id)).toMatch(STATUS_FOLLOW_KEY);
    expect(statusFollowKey("c", id)).not.toContain(id);
    expect(statusFollowKey("g", "Core")).toMatch(/^g-/);
    const keys = new Set<string>();
    for (let index = 0; index < 50; index++) {
      keys.add(
        statusFollowKey("c", `cmp_01JZ0000000000000000000${index.toString().padStart(2, "0")}`),
      );
      keys.add(statusFollowKey("g", `Group ${index}`));
    }
    expect(keys.size).toBe(100);
  });

  test("the audience: each touched component and its group; none touched is everyone", () => {
    const components = [
      { id: "cmp_a", group: "Core" },
      { id: "cmp_b", group: null },
    ];
    expect(statusAudience(components, [])).toBeNull();
    // A component that is gone counts as none.
    expect(statusAudience(components, ["cmp_gone"])).toBeNull();
    expect(statusAudience(components, ["cmp_a"])).toEqual({
      affected: [statusFollowKey("c", "cmp_a"), statusFollowKey("g", "Core")],
      known: [
        statusFollowKey("c", "cmp_a"),
        statusFollowKey("g", "Core"),
        statusFollowKey("c", "cmp_b"),
      ],
    });
  });
});
