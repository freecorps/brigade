import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  createMemoryStore,
  INCIDENT_TITLE_MAX,
  isKnownWebhookPayload,
  MAX_WEBHOOKS_PER_WORKSPACE,
  mutations,
  newId,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  TABLES,
  toJsonSchema,
  WEBHOOK_DISABLE_AFTER_MS,
  WEBHOOK_DISABLE_FAILURES,
  WEBHOOK_LOG_SIZE,
  WEBHOOK_ROTATION_GRACE_MS,
  WEBHOOK_TEST_EVERY_MS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_PAYLOADS,
  webhookPayload,
  webhookPayloadValidator,
  webhookTargetProblem,
  webhookWants,
  type BrigadeTables,
  type Infer,
  type IncidentRow,
  type MutationContext,
  type Role,
  type WebhookPayload,
  type WebhookPayloadType,
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
    expect(Object.keys(mutations)).not.toContain("webhook.redeliver");
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

  test("an event missing a field (or holding the wrong kind) has no payload, never a coerced one", () => {
    const alert = (data: unknown) => webhookPayload(event("alert.fired", data, "alt_x"), {});
    expect(alert({ id: "alt_x", monitorId: "mon_x", incidentId: incident.id })?.data).toMatchObject(
      { alertId: "alt_x", incidentId: incident.id },
    );
    expect(alert({ id: "alt_x", monitorId: "mon_x" })).toBeUndefined();
    expect(alert({ id: null, monitorId: "mon_x", incidentId: incident.id })).toBeUndefined();
    for (const [type, data] of [
      ["incident.acknowledged", {}],
      ["incident.acknowledged", { by: null }],
      ["incident.update_posted", { body: 42 }],
      ["incident.status_changed", { from: "triage", to: "sideways" }],
      ["incident.severity_changed", { from: "sev2" }],
      ["incident.role_assigned", { role: "chef", from: null, to: "usr_ana" }],
      ["incident.role_assigned", { role: "commander", from: 7, to: "usr_ana" }],
      ["escalation.paged", { incidentId: incident.id, level: 1, reason: "started" }],
      ["escalation.paged", { incidentId: incident.id, level: 0, round: 1, reason: "started" }],
      ["escalation.paged", { incidentId: incident.id, level: 1, round: 1, reason: "bored" }],
    ] as const) {
      const payload = webhookPayload(event(type, data), { incident });
      expect(payload, `${type} ${JSON.stringify(data)}`).toBeUndefined();
    }
    expect(
      webhookPayload(event("alert.resolved", { id: "alt_x", monitorId: "mon_x" }, "alt_x"), {}),
    ).toBeUndefined();
    expect(
      webhookPayload(event("monitor.status_changed", { from: "up" }, "mon_x"), {}),
    ).toBeUndefined();
    // A role cleared is null, never the string "null".
    expect(
      webhookPayload(event("incident.role_assigned", { role: "commander", to: "usr_ana" }), {
        incident,
      })?.data,
    ).toMatchObject({ role: "commander", from: null, to: "usr_ana" });
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

describe("payload validators", () => {
  const at = (n: number) => newId("evt", T, () => new Uint8Array(16).fill(n));
  const incident: IncidentRow = {
    id: newId("inc", T, random),
    number: 142,
    title: "Checkout down",
    severity: "sev1",
    status: "investigating",
    declaredAt: T,
    declaredBy: "usr_ana",
    acknowledgedAt: T + 60_000,
    acknowledgedBy: "usr_ana",
    updatedAt: T,
  };
  const monitorId = newId("mon", T, random);
  const alertId = newId("alt", T, random);
  const monitor = { name: "Checkout", kind: "http", status: "down" } as const;
  /** One source event per payload type, as the outbox writes them, with what the shard reads for it. */
  const SOURCES: Record<WebhookPayloadType, [subject: string, data: unknown, context: object]> = {
    "incident.declared": [incident.id, { severity: "sev1" }, { incident }],
    "incident.status_changed": [incident.id, { from: "triage", to: "investigating" }, { incident }],
    "incident.severity_changed": [incident.id, { from: "sev2", to: "sev1" }, { incident }],
    "incident.acknowledged": [incident.id, { by: "usr_ana" }, { incident }],
    "incident.update_posted": [incident.id, { body: "Rolling back.\nETA 10 min." }, { incident }],
    "incident.role_assigned": [
      incident.id,
      { role: "commander", from: null, to: "usr_ana" },
      { incident },
    ],
    "alert.fired": [alertId, { id: alertId, monitorId, incidentId: incident.id }, { monitor }],
    "alert.resolved": [alertId, { id: alertId, monitorId, reason: "recovered" }, {}],
    "monitor.status_changed": [monitorId, { from: "up", to: "down" }, { monitor }],
    "escalation.paged": [
      "esc_x",
      { incidentId: incident.id, level: null, round: 2, reason: "exhausted", userIds: [] },
      { incident },
    ],
    "webhook.test": [newId("whk", T, random), { id: "" }, {}],
  };

  test("every type has a validator, the catalog's order then the test", () => {
    expect(Object.keys(WEBHOOK_PAYLOADS)).toEqual([...WEBHOOK_EVENT_TYPES, "webhook.test"]);
    // Each validator accepts exactly its type's payload: no field more, less or of another kind.
    expectTypeOf<{
      [K in WebhookPayloadType]: Infer<(typeof WEBHOOK_PAYLOADS)[K]>;
    }>().toEqualTypeOf<{ [K in WebhookPayloadType]: Extract<WebhookPayload, { type: K }> }>();
  });

  test("accept every payload webhookPayload makes, unchanged", () => {
    let n = 0;
    for (const [type, [subject, data, context]] of Object.entries(SOURCES)) {
      const source = {
        id: at(++n),
        type,
        time: new Date(T).toISOString(),
        workspaceId: newId("ws", T, random),
        actor: { kind: "user" as const, id: "usr_ana" },
        subject,
        data: type === "webhook.test" ? { id: subject } : data,
      };
      const payload = webhookPayload(source, context);
      expect(payload, type).toBeDefined();
      const parsed = webhookPayloadValidator(JSON.parse(JSON.stringify(payload)));
      expect(parsed, type).toEqual({ ok: true, value: payload });
    }
  });

  test("drop fields added since, refuse another version or shape", () => {
    const payload = {
      version: 1,
      id: at(1),
      type: "webhook.test",
      time: new Date(T).toISOString(),
      workspaceId: newId("ws", T, random),
      actor: { kind: "user", id: "usr_ana", extra: 1 },
      data: { webhookId: newId("whk", T, random), extra: true },
      extra: "x",
    };
    const parsed = webhookPayloadValidator(payload);
    expect(parsed.ok && parsed.value).toEqual({
      ...payload,
      actor: { kind: "user", id: "usr_ana" },
      data: { webhookId: payload.data.webhookId },
      extra: undefined,
    });
    expect(parsed.ok && "extra" in parsed.value).toBe(false);
    expect(webhookPayloadValidator({ ...payload, version: 2 }).ok).toBe(false);
    expect(webhookPayloadValidator({ ...payload, data: {} }).ok).toBe(false);
    expect(webhookPayloadValidator({ ...payload, id: "nope" }).ok).toBe(false);
    expect(webhookPayloadValidator(null).ok).toBe(false);
  });

  test("take what a newer Brigade may add within version 1", () => {
    const incidentPayload = webhookPayload(
      {
        id: at(1),
        type: "incident.status_changed",
        time: new Date(T).toISOString(),
        workspaceId: newId("ws", T, random),
        actor: { kind: "user", id: "usr_ana" },
        subject: incident.id,
        data: { from: "triage", to: "investigating" },
      },
      { incident },
    )!;
    const newer = JSON.parse(JSON.stringify(incidentPayload));
    newer.actor.kind = "robot";
    newer.data.to = "postmortem";
    newer.data.incident.severity = "sev0";
    newer.data.incident.title = "x".repeat(INCIDENT_TITLE_MAX * 10);
    const parsed = webhookPayloadValidator(newer);
    expect(parsed).toEqual({ ok: true, value: newer });
    expect(parsed.ok && isKnownWebhookPayload(parsed.value)).toBe(true);
    expect(
      webhookPayloadValidator({ ...newer, data: { ...newer.data, to: "x".repeat(65) } }).ok,
    ).toBe(false);
    expect(
      webhookPayloadValidator({
        ...newer,
        data: { ...newer.data, incident: { ...newer.data.incident, title: "x".repeat(70_000) } },
      }).ok,
    ).toBe(false);

    // A type added since: the envelope checked, the data as sent.
    const added = { ...newer, type: "member.removed", data: { anything: [1, 2] } };
    const unknown = webhookPayloadValidator(added);
    expect(unknown).toEqual({ ok: true, value: added });
    expect(unknown.ok && isKnownWebhookPayload(unknown.value)).toBe(false);
    const own = webhookPayloadValidator({ ...added, type: "toString" });
    expect(own.ok && isKnownWebhookPayload(own.value)).toBe(false);
    expect(webhookPayloadValidator({ ...added, version: 2 }).ok).toBe(false);
    expect(webhookPayloadValidator({ ...added, workspaceId: "nope" }).ok).toBe(false);
    expect(webhookPayloadValidator({ ...added, type: "" }).ok).toBe(false);
    expect(webhookPayloadValidator({ ...added, type: 1 }).ok).toBe(false);
  });

  test("name an API token as the actor (`token`, `tok_…`), and as `by` when it acknowledged", () => {
    const token = "tok_01JB0000000000000000000001";
    const payload = webhookPayload(
      {
        id: at(1),
        type: "incident.acknowledged",
        time: new Date(T).toISOString(),
        workspaceId: newId("ws", T, random),
        actor: { kind: "token", id: token },
        subject: incident.id,
        data: { by: token },
      },
      { incident },
    )!;
    expect(payload).toMatchObject({ actor: { kind: "token", id: token }, data: { by: token } });
    const parsed = webhookPayloadValidator(JSON.parse(JSON.stringify(payload)));
    expect(parsed.ok && isKnownWebhookPayload(parsed.value)).toBe(true);
    expect(parsed.ok && parsed.value.actor.kind).toBe("token");
    // The reference lists it among the known kinds, so a receiver's generated types have it.
    expect(JSON.stringify(toJsonSchema(WEBHOOK_PAYLOADS["incident.acknowledged"]))).toContain(
      '"token"',
    );
  });
});
