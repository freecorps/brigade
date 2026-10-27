import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  MAX_WEBHOOKS_PER_WORKSPACE,
  mutations,
  newId,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  TABLES,
  WEBHOOK_DISABLE_AFTER_MS,
  WEBHOOK_DISABLE_FAILURES,
  WEBHOOK_LOG_SIZE,
  WEBHOOK_ROTATION_GRACE_MS,
  WEBHOOK_TEST_EVERY_MS,
  webhookPayload,
  webhookTargetProblem,
  webhookWants,
  type BrigadeTables,
  type IncidentRow,
  type MutationContext,
  type Role,
  type WebhookRow,
  type WebhookSourceEvent,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 26, 12, 0, 0);
const SECRET = `v1.${"A".repeat(16)}.${"b".repeat(40)}`;
const OTHER = `v1.${"C".repeat(16)}.${"d".repeat(40)}`;
let ids = 0;
const random = (n: number) => new Uint8Array(n).fill(++ids % 256);
const newWebhookId = (at = T) => newId("whk", at, random);

const ctx = (role: Role = "owner", now = T): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now,
  server: true,
});

function created(events: string[] = ["incident.declared"]) {
  const store = createMemoryStore<BrigadeTables>();
  const id = newWebhookId();
  const result = runMutation(
    serverMutations,
    "webhook.create",
    {
      id,
      url: "https://hooks.example.com/brigade",
      description: "Ops bot",
      events,
      secret: SECRET,
    },
    store,
    ctx(),
  );
  expect(result).toMatchObject({ ok: true });
  return { store, id };
}

const attempt = (ok: boolean, at: number) => ({
  eventId: newId("evt", at, random),
  type: "incident.declared",
  attempt: 1,
  at,
  ok,
  status: ok ? 200 : 500,
  ms: 120,
  error: ok ? null : "status",
  snippet: ok ? null : "Internal error",
});

describe("webhook endpoints", () => {
  test("create, update, enable, rotate and delete emit events without the URL or secret", () => {
    const { store, id } = created(["incident.declared", "alert.fired"]);
    const row = store.get("webhooks", id)!;
    expect(row).toMatchObject({ enabled: true, events: ["incident.declared", "alert.fired"] });
    expect(TABLES.webhook_secrets.serverOnly).toBe(true);
    expect(store.get("webhook_secrets", id)).toMatchObject({ secret: SECRET, previous: null });

    const updated = runMutation(
      mutations,
      "webhook.update",
      // Out of order and with a different URL: stored in catalog order.
      {
        id,
        url: "https://other.example.com/x",
        description: "",
        events: ["alert.fired", "incident.declared"],
      },
      store,
      ctx("admin"),
    );
    expect(updated).toEqual({
      ok: true,
      events: [
        {
          type: "webhook.updated",
          subject: id,
          data: { id, events: ["incident.declared", "alert.fired"], urlChanged: true },
        },
      ],
    });
    const off = runMutation(mutations, "webhook.setEnabled", { id, enabled: false }, store, ctx());
    expect(off).toMatchObject({
      ok: true,
      events: [{ type: "webhook.disabled", data: { reason: "manual" } }],
    });

    const rotated = runMutation(
      serverMutations,
      "webhook.rotateSecret",
      { id, secret: OTHER },
      store,
      ctx("owner", T + 1000),
    );
    expect(rotated).toMatchObject({
      ok: true,
      events: [{ type: "webhook.secret_rotated", data: { id } }],
    });
    expect(store.get("webhook_secrets", id)).toEqual({
      id,
      secret: OTHER,
      previous: SECRET,
      previousUntil: T + 1000 + WEBHOOK_ROTATION_GRACE_MS,
    });

    for (const result of [updated, off, rotated]) {
      expect(JSON.stringify(result)).not.toContain("example.com");
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
    expect(runMutation(mutations, "webhook.delete", { id }, store, ctx())).toMatchObject({
      ok: true,
    });
    expect(store.get("webhooks", id)).toBeUndefined();
    expect(store.get("webhook_secrets", id)).toBeUndefined();
  });

  test("only owners and admins manage or even see endpoints", () => {
    const { store, id } = created();
    for (const role of ["responder", "viewer"] as const) {
      expect(
        runMutation(mutations, "webhook.setEnabled", { id, enabled: false }, store, ctx(role)),
      ).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(runQuery(queries, "webhook.all", {}, store, role)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
    expect(runQuery(queries, "webhook.all", {}, store, "admin")).toMatchObject({ ok: true });
  });

  test("create and rotate are server only: a socket cannot set a secret", () => {
    expect(Object.keys(mutations)).not.toContain("webhook.create");
    expect(Object.keys(mutations)).not.toContain("webhook.rotateSecret");
    expect(Object.keys(mutations)).not.toContain("webhook.record");
  });

  test(`at most ${MAX_WEBHOOKS_PER_WORKSPACE} per workspace`, () => {
    const store = createMemoryStore<BrigadeTables>();
    const create = () =>
      runMutation(
        serverMutations,
        "webhook.create",
        {
          id: newWebhookId(),
          url: "https://hooks.example.com/",
          description: "",
          events: ["incident.declared"],
          secret: SECRET,
        },
        store,
        ctx(),
      );
    for (let i = 0; i < MAX_WEBHOOKS_PER_WORKSPACE; i++)
      expect(create()).toMatchObject({ ok: true });
    expect(create()).toMatchObject({ ok: false, error: { code: "limit_reached" } });
  });

  test("refuses a filter outside the public catalog", () => {
    const store = createMemoryStore<BrigadeTables>();
    for (const events of [
      [],
      ["member.removed"],
      ["device.registered"],
      ["incident.declared", "incident.declared"],
    ]) {
      expect(
        runMutation(
          serverMutations,
          "webhook.create",
          {
            id: newWebhookId(),
            url: "https://hooks.example.com/",
            description: "",
            events,
            secret: SECRET,
          },
          store,
          ctx(),
        ),
      ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    }
  });

  test("a test event at most once per interval", () => {
    const { store, id } = created();
    expect(runMutation(mutations, "webhook.sendTest", { id }, store, ctx())).toMatchObject({
      ok: true,
      events: [{ type: "webhook.test", subject: id, data: { id } }],
    });
    expect(
      runMutation(mutations, "webhook.sendTest", { id }, store, ctx("owner", T + 1)),
    ).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
    expect(
      runMutation(
        mutations,
        "webhook.sendTest",
        { id },
        store,
        ctx("owner", T + WEBHOOK_TEST_EVERY_MS),
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("target rules", () => {
  test("https to a public host only, as monitors' rules and no Cloudflare address", () => {
    expect(webhookTargetProblem("https://hooks.example.com/brigade?token=x")).toBeNull();
    expect(webhookTargetProblem("https://hooks.example.com:8443/")).toBeNull();
    for (const url of [
      "http://hooks.example.com/",
      "https://localhost/",
      "https://127.0.0.1/",
      "https://10.0.0.8/",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://0x7f.1/",
      "https://printer.local/",
      "https://metadata.internal/",
      "https://user:pass@hooks.example.com/",
      "https://hooks.example.com:6379/",
      "https://104.16.0.1/",
      "https://[2606:4700::1]/",
      "ftp://hooks.example.com/",
      "not a url",
    ]) {
      expect(webhookTargetProblem(url), url).not.toBeNull();
    }
  });
});

describe("auto-disable", () => {
  test(`turns an endpoint off after ${WEBHOOK_DISABLE_FAILURES} failures over a day, and a success resets it`, () => {
    const { store, id } = created();
    const record = (ok: boolean, at: number) =>
      runMutation(
        serverMutations,
        "webhook.record",
        { id, attempt: attempt(ok, at) },
        store,
        ctx("admin", at),
      );
    // Many failures within the day: still on.
    for (let i = 0; i < WEBHOOK_DISABLE_FAILURES + 2; i++) {
      expect(record(false, T + i * 1000)).toEqual({ ok: true, events: [] });
    }
    expect(store.get("webhooks", id)).toMatchObject({ enabled: true, failingSince: T });
    // A success starts it over.
    expect(record(true, T + 60_000)).toEqual({ ok: true, events: [] });
    expect(store.get("webhooks", id)).toMatchObject({ failures: 0, failingSince: null });
    // A day of failures, but fewer than the count: still on.
    expect(record(false, T + 100_000).ok).toBe(true);
    expect(record(false, T + 100_000 + WEBHOOK_DISABLE_AFTER_MS).ok).toBe(true);
    expect(store.get("webhooks", id)!.enabled).toBe(true);
    let last;
    for (let i = 2; i < WEBHOOK_DISABLE_FAILURES; i++) {
      last = record(false, T + 100_000 + WEBHOOK_DISABLE_AFTER_MS + i);
    }
    expect(last).toEqual({
      ok: true,
      events: [
        {
          type: "webhook.disabled",
          subject: id,
          data: { id, reason: "failing", failures: WEBHOOK_DISABLE_FAILURES },
        },
      ],
    });
    const row = store.get("webhooks", id)!;
    expect(row).toMatchObject({ enabled: false, disabledReason: "failing" });
    expect(row.recent).toHaveLength(WEBHOOK_LOG_SIZE);
    expect(row.recent[0]!.at).toBeGreaterThan(row.recent[1]!.at);
    // Turned back on, it gets a full day again.
    expect(
      runMutation(mutations, "webhook.setEnabled", { id, enabled: true }, store, ctx()),
    ).toMatchObject({
      ok: true,
      events: [{ type: "webhook.enabled" }],
    });
    expect(store.get("webhooks", id)).toMatchObject({
      failures: 0,
      failingSince: null,
      disabledReason: null,
    });
  });
});

describe("payload", () => {
  const incident: IncidentRow = {
    id: "inc_01JB0000000000000000000001",
    number: 142,
    title: "Checkout down",
    severity: "sev1",
    status: "investigating",
    declaredAt: T,
    declaredBy: "usr_ana",
    acknowledgedAt: null,
    acknowledgedBy: null,
    updatedAt: T,
  };
  const event = (type: string, data: unknown, subject = incident.id): WebhookSourceEvent => ({
    id: "evt_01JB0000000000000000000001",
    type,
    time: new Date(T).toISOString(),
    workspaceId: "ws_01JB0000000000000000000001",
    actor: { kind: "user", id: "usr_ana" },
    subject,
    data,
  });

  test("a versioned envelope with only the public fields", () => {
    expect(
      webhookPayload(event("incident.severity_changed", { from: "sev2", to: "sev1" }), {
        incident,
      }),
    ).toEqual({
      version: 1,
      id: "evt_01JB0000000000000000000001",
      type: "incident.severity_changed",
      time: "2026-10-26T12:00:00.000Z",
      workspaceId: "ws_01JB0000000000000000000001",
      actor: { kind: "user", id: "usr_ana" },
      data: {
        incident: {
          id: incident.id,
          number: 142,
          title: "Checkout down",
          severity: "sev1",
          status: "investigating",
          declaredAt: "2026-10-26T12:00:00.000Z",
          acknowledgedAt: null,
        },
        from: "sev2",
        to: "sev1",
      },
    });
  });

  test("an escalation page says how many, never who or why someone was missed", () => {
    const paged = webhookPayload(
      event("escalation.paged", {
        incidentId: incident.id,
        policyId: "esc_x",
        level: 1,
        round: 0,
        userIds: ["usr_ana", "usr_bia"],
        missed: [{ userId: "usr_caio", reason: "no_devices", scheduleId: null, schedule: null }],
        reason: "started",
        run: "evt_x",
        step: 1,
      }),
      { incident },
    );
    expect(paged?.data).toMatchObject({
      level: 1,
      round: 0,
      reason: "started",
      paged: 2,
      missed: 1,
    });
    expect(JSON.stringify(paged)).not.toContain("usr_bia");
    expect(JSON.stringify(paged)).not.toContain("no_devices");
  });

  test("a monitor never carries its URL; a deleted one keeps only its id", () => {
    const resolved = webhookPayload(
      event("alert.resolved", { id: "alt_x", monitorId: "mon_x", reason: "deleted" }, "alt_x"),
      {},
    );
    expect(resolved?.data).toEqual({
      alertId: "alt_x",
      monitor: { id: "mon_x", name: null, kind: null, status: null },
      reason: "deleted",
    });
  });

  test("nothing outside the catalog", () => {
    for (const type of [
      "member.removed",
      "device.registered",
      "notification.failed",
      "webhook.disabled",
    ]) {
      expect(webhookPayload(event(type, {}), { incident })).toBeUndefined();
    }
  });

  test("an endpoint takes the events it filters on, while on, from when it was created", () => {
    const row = {
      id: "whk_x",
      enabled: true,
      events: ["incident.declared"],
      createdAt: T,
    } as WebhookRow;
    expect(webhookWants(row, event("incident.declared", {}))).toBe(true);
    expect(webhookWants(row, event("incident.acknowledged", {}))).toBe(false);
    expect(webhookWants({ ...row, enabled: false }, event("incident.declared", {}))).toBe(false);
    expect(webhookWants({ ...row, createdAt: T + 1 }, event("incident.declared", {}))).toBe(false);
    // Its own test, on or off, whatever its filter; never another endpoint's.
    expect(webhookWants({ ...row, enabled: false }, event("webhook.test", { id: "whk_x" }))).toBe(
      true,
    );
    expect(webhookWants(row, event("webhook.test", { id: "whk_y" }))).toBe(false);
  });
});
