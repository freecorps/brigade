// Alert sources end to end (RFC 0005 "Alert sources"), a paging path: `POST /alerts/:token` refusing alike, the
// providers' signatures and headers, and each payload turning into exactly the incidents (pages) it should: a dedup
// storm pages once, an unreadable payload still pages, an unmatched alert pages through the default route, and a
// dropped alert says which route dropped it.
import { env, exports } from "cloudflare:workers";
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import {
  alertSourceToken,
  newHeartbeatSecret,
  newId,
  type Actor,
  type AlertMapping,
  type AlertSourceKind,
} from "@freecorps/brigade-schema";
import grafanaFiring from "../../../packages/schema/tests/fixtures/alerts/grafana-firing.json";
import grafanaResolved from "../../../packages/schema/tests/fixtures/alerts/grafana-resolved.json";
import sentryCritical from "../../../packages/schema/tests/fixtures/alerts/sentry-metric-critical.json";
import { AlertIntake, hmacHex, MAX_ALERT_BODY, same } from "../src/alert-intake.ts";
import { receiveAlerts } from "../src/index.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { asksForPage } from "../src/paging.ts";
import { Shard } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const owner: Actor = { kind: "user", id: "usr_ana", role: "owner" };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

let names = 0;

/** A provisioned workspace (in D1 too: the Worker looks it up before waking the shard). */
async function workspace() {
  const id = newId("ws", Date.now() + ++names, random);
  await env.DB.prepare(
    'insert into "organization" ("id", "name", "slug", "createdAt") values (?, ?, ?, ?)',
  )
    .bind(id, "Example", `alerts-${id}`, new Date().toISOString())
    .run();
  const stub = env.WORKSPACE.getByName(id);
  expect(await stub.provision({ id, name: "Example" }, owner)).toEqual({ ok: true });
  const withShard = <R>(fn: (shard: Shard, sql: SqlStorage) => R | Promise<R>) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state.storage.sql,
      ),
    );
  let mutation = 0;
  const run = (name: string, args: object) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: `m${++mutation}`,
        actor: owner,
        name,
        args,
        now: Date.now(),
      });
      return result;
    });
  return { id, stub, withShard, run };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

/** Creates a source as the dashboard does (it makes the secret) and answers its token. */
async function source(
  ws: Workspace,
  kind: AlertSourceKind,
  options: { header?: { name: string; value: string }; signingSecret?: string; name?: string } = {},
) {
  const id = newId("src", Date.now(), random);
  const secret = newHeartbeatSecret(random);
  expect(
    await ws.run("alertSource.create", {
      id,
      name: options.name ?? "Grafana",
      kind,
      tokenHash: await sha256Hex(secret),
      auth: options.header
        ? { headerName: options.header.name, headerHash: await sha256Hex(options.header.value) }
        : null,
      signingSecret: options.signingSecret ?? null,
    }),
  ).toMatchObject({ ok: true });
  return { id, token: alertSourceToken(ws.id, id, secret) };
}

const post = (token: string, body: string, headers: Record<string, string> = {}) =>
  exports.default.fetch(`http://localhost/alerts/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });

const request = (token: string) =>
  new Request(`http://api.test/alerts/${token}`, {
    method: "POST",
    body: JSON.stringify(grafanaFiring),
  });

/** The shard namespace, noting each workspace it wakes. */
const watched = (woken: string[]) =>
  new Proxy(env.WORKSPACE, {
    get(target, property) {
      if (property !== "getByName") return Reflect.get(target, property);
      return (name: string) => {
        woken.push(name);
        return target.getByName(name);
      };
    },
  });

/** Each outbox event's type and actor, in order. */
const outbox = (sql: SqlStorage) =>
  sql
    .exec<{ event: string }>("select event from outbox order by seq")
    .toArray()
    .map((row) => {
      const event = JSON.parse(row.event) as { type: string; actor: { id: string } };
      return `${event.type} by ${event.actor.id}`;
    });

/** What pages: every `incident.declared` in the outbox (RFC 0005 "What pages"). */
const pages = (sql: SqlStorage) =>
  outbox(sql).filter((line) => line.startsWith("incident.declared"));

describe("POST /alerts/:token", () => {
  test("every refusal is the same 404, and a made-up workspace wakes no shard", async () => {
    const ws = await workspace();
    const { id, token } = await source(ws, "grafana");
    const body = JSON.stringify(grafanaFiring);
    const wrong = alertSourceToken(ws.id, id, newHeartbeatSecret(random));
    const refusals = [
      await post(wrong, body),
      await post(alertSourceToken(ws.id, newId("src", Date.now(), random), "A".repeat(43)), body),
      await post("not-a-token", body),
    ];
    const madeUp = newId("ws", Date.now(), random);
    refusals.push(await post(alertSourceToken(madeUp, id, "A".repeat(43)), body));
    for (const response of refusals) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    const made = await listDurableObjectIds(env.WORKSPACE);
    expect(made.map((one) => one.toString())).not.toContain(
      env.WORKSPACE.idFromName(madeUp).toString(),
    );
    expect(
      (await exports.default.fetch(`http://localhost/alerts/${token}`, { method: "GET" })).status,
    ).toBe(405);
    await ws.withShard((_shard, sql) => expect(pages(sql)).toEqual([]));
  });

  test("ALERT_WORKSPACE_LIMIT holds a workspace before its shard wakes, with 503 and Retry-After", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana");
    const keys: string[] = [];
    const woken: string[] = [];
    const limited = (success: boolean, fails = false) =>
      ({
        ...env,
        ALERT_WORKSPACE_LIMIT: {
          limit: async ({ key }: { key: string }) => {
            keys.push(key);
            if (fails) throw new Error("limiter down");
            return { success };
          },
        },
        WORKSPACE: watched(woken),
      }) as unknown as Env;
    const refused = await receiveAlerts(request(token), limited(false), token);
    // 503, not 429: Datadog retries a 5xx and gives up on a 429.
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("60");
    expect(keys).toEqual([ws.id]);
    expect(woken).toEqual([]);
    // A limiter that fails lets the alert through: a lost alert is worse than a busy shard.
    expect((await receiveAlerts(request(token), limited(true, true), token)).status).toBe(202);
  });

  test("a flood of made-up secrets spends ALERT_WORKSPACE_LIMIT, and a source already sending flows past it", async () => {
    const ws = await workspace();
    const { id, token } = await source(ws, "grafana");
    const woken: string[] = [];
    let open = true;
    const limits = {
      ...env,
      ALERT_WORKSPACE_LIMIT: { limit: async () => ({ success: open }) },
      WORKSPACE: watched(woken),
    } as unknown as Env;
    expect((await receiveAlerts(request(token), limits, token)).status).toBe(202);
    // The flood spends the workspace's bucket: made-up secrets get 503 without waking the shard.
    open = false;
    const made = alertSourceToken(ws.id, id, newHeartbeatSecret(random));
    expect((await receiveAlerts(request(made), limits, made)).status).toBe(503);
    expect(woken).toHaveLength(1);
    // The real token was accepted lately: it skips the bucket, and the shard checks it again.
    expect((await receiveAlerts(request(token), limits, token)).status).toBe(202);
    expect(woken).toHaveLength(2);
    // A source this isolate has not seen accepted waits for the bucket like any unknown token.
    const { token: fresh } = await source(ws, "grafana");
    expect((await receiveAlerts(request(fresh), limits, fresh)).status).toBe(503);
    expect(woken).toHaveLength(2);
  });

  test("wrong secrets are counted apart and never spend the source's budget", async () => {
    const ws = await workspace();
    const { id, token } = await source(ws, "grafana");
    const wrong = alertSourceToken(ws.id, id, newHeartbeatSecret(random));
    const woken: string[] = [];
    const refusedKeys: string[] = [];
    const limits = {
      ...env,
      // The refused bucket is spent at once: from then on, a token refused lately wakes no shard.
      ALERT_REFUSED_LIMIT: {
        limit: async ({ key }: { key: string }) => {
          refusedKeys.push(key);
          return { success: false };
        },
      },
      WORKSPACE: watched(woken),
    } as unknown as Env;
    expect((await receiveAlerts(request(wrong), limits, wrong)).status).toBe(404);
    // Refused lately, answered without the shard: 503 with Retry-After (never a 404 a sender gives up on), so a real
    // token refused once is retried once the minute is over, and checked again then.
    const again = await receiveAlerts(request(wrong), limits, wrong);
    expect(again.status).toBe(503);
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(again.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    expect(woken).toHaveLength(1);
    expect(refusedKeys).toEqual([ws.id]);
    // The real token still goes through, and the shard spends the source's own budget only for it.
    expect((await receiveAlerts(request(token), limits, token)).status).toBe(202);
    expect(woken).toHaveLength(2);
  });

  test("ALERT_LIMIT holds a source once the shard checked its secrets, as busy (503)", async () => {
    const ws = await workspace();
    const { id, token } = await source(ws, "grafana");
    const secret = token.split(".")[2]!;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const body = new TextEncoder().encode(JSON.stringify(grafanaFiring)).buffer as ArrayBuffer;
    const asked: string[] = [];
    const results = await ws.withShard(async (shard) => {
      const intake = new AlertIntake({
        shard,
        randomBytes: random,
        log: () => {},
        committed: () => {},
        allow: async (sourceId) => {
          asked.push(sourceId);
          return false;
        },
      });
      const wrong = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("wrong"));
      return [
        await intake.receive(id, wrong, body, {}),
        await intake.receive(id, digest, body, {}),
      ];
    });
    expect(results).toEqual([{ status: "not_found" }, { status: "busy" }]);
    // Asked only for the verified payload.
    expect(asked).toEqual([id]);
    const response = await post(token, JSON.stringify(grafanaFiring));
    expect(response.status).toBe(202);
  });

  test("a payload over the limit still pages, unread: the unreadable alert, answered 202", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "generic", { name: "Batch jobs" });
    const huge = "x".repeat(MAX_ALERT_BODY + 1);
    const response = await post(token, huge);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, alerts: 1, malformed: true, tooLarge: true });
    // A wrong secret is still the same 404.
    const [, sourceId] = token.split(".");
    const wrong = alertSourceToken(ws.id, sourceId!, newHeartbeatSecret(random));
    expect((await post(wrong, huge)).status).toBe(404);
    // Sent again, a repeat: one alert, one page.
    expect((await post(token, huge)).status).toBe(202);
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toEqual(["incident.declared by sys_alerts"]);
      expect(shard.store.scan("incidents")).toMatchObject([
        { title: "Unreadable alert from Batch jobs (payload too large)", severity: "sev2" },
      ]);
      expect(shard.store.scan("source_alerts")).toMatchObject([
        { dedupKey: "malformed", outcome: "opened", reason: "malformed", repeats: 1 },
      ]);
    });
  });

  test("a payload over the limit checks the source's header; a signed source is authenticated by its URL alone", async () => {
    const ws = await workspace();
    const header = { name: "X-Brigade-Key", value: "example-header-value" };
    const { token } = await source(ws, "grafana", { header });
    const huge = "x".repeat(MAX_ALERT_BODY + 1);
    expect((await post(token, huge)).status).toBe(404);
    expect((await post(token, huge, { "X-Brigade-Key": "wrong" })).status).toBe(404);
    expect((await post(token, huge, { "X-Brigade-Key": header.value })).status).toBe(202);
    // Sentry signs every payload, but a signature cannot be checked without the body: the secret URL is the check.
    const { token: signed } = await source(ws, "sentry", {
      signingSecret: "example-client-secret",
      name: "Sentry",
    });
    expect((await post(signed, huge, { "Sentry-Hook-Resource": "metric_alert" })).status).toBe(202);
    await ws.withShard((_shard, sql) => expect(pages(sql)).toHaveLength(2));
  });

  test("a source's header is checked, by its hash", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana", {
      header: { name: "Authorization", value: "Basic YnJpZ2FkZTpleGFtcGxl" },
    });
    const body = JSON.stringify(grafanaFiring);
    expect((await post(token, body)).status).toBe(404);
    expect((await post(token, body, { Authorization: "Basic d3Jvbmc6d3Jvbmc=" })).status).toBe(404);
    expect((await post(token, body, { Authorization: "Basic YnJpZ2FkZTpleGFtcGxl" })).status).toBe(
      202,
    );
  });

  test("Sentry's signature: HMAC-SHA256 of the body with the client secret", async () => {
    const ws = await workspace();
    const secret = "example-client-secret";
    const { token } = await source(ws, "sentry", { signingSecret: secret, name: "Sentry" });
    const body = JSON.stringify(sentryCritical);
    const headers = { "Sentry-Hook-Resource": "metric_alert" };
    expect((await post(token, body, headers)).status).toBe(404);
    expect(
      (
        await post(token, body, {
          ...headers,
          "Sentry-Hook-Signature": await hmacHex("another-secret", body),
        })
      ).status,
    ).toBe(404);
    const accepted = await post(token, body, {
      ...headers,
      "Sentry-Hook-Signature": await hmacHex(secret, body),
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ ok: true, alerts: 1, malformed: false });
    await ws.withShard((shard) => {
      expect(shard.store.scan("source_alerts")).toMatchObject([
        { dedupKey: "sentry:metric:7", outcome: "opened" },
      ]);
    });
  });

  test("Grafana's optional HMAC signature, when the source has a secret", async () => {
    const ws = await workspace();
    const secret = "example-grafana-secret";
    const { token } = await source(ws, "grafana", { signingSecret: secret });
    const body = JSON.stringify(grafanaFiring);
    expect((await post(token, body)).status).toBe(404);
    const signed = await post(token, body, {
      "X-Grafana-Alerting-Signature": await hmacHex(secret, body),
    });
    expect(signed.status).toBe(202);
    // Signed over the bytes as sent: bytes that are not UTF-8 would not survive being decoded and encoded again.
    const raw = new Uint8Array([...new TextEncoder().encode('{"alerts":'), 0xff, 0xfe, 0x7d]);
    const odd = await exports.default.fetch(`http://localhost/alerts/${token}`, {
      method: "POST",
      headers: { "X-Grafana-Alerting-Signature": await hmacHex(secret, raw) },
      body: raw,
    });
    expect(odd.status).toBe(202);
    expect(await odd.json()).toMatchObject({ ok: true, malformed: true });
  });
});

describe("alerts that page", () => {
  test("a Grafana group opens one incident per alert, as sys_alerts; resolved resolves them", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana");
    const response = await post(token, JSON.stringify(grafanaFiring));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, alerts: 2, malformed: false });
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toEqual([
        "incident.declared by sys_alerts",
        "incident.declared by sys_alerts",
      ]);
      const incidents = shard.store.scan("incidents");
      expect(incidents.map((row) => row.severity).sort()).toEqual(["sev1", "sev2"]);
    });
    expect((await post(token, JSON.stringify(grafanaResolved))).status).toBe(202);
    await ws.withShard((shard, sql) => {
      const resolved = shard.store
        .scan("source_alerts")
        .find((row) => row.dedupKey === "c6eadffa33fcdf37");
      expect(resolved).toMatchObject({ status: "resolved" });
      expect(shard.store.get("incidents", resolved!.incidentId!)?.status).toBe("resolved");
      expect(outbox(sql)).toContain("incident.status_changed by sys_alerts");
    });
  });

  test("a flapping alert reopens its incident and pages again, rather than opening another", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana");
    const one = (status: string) =>
      JSON.stringify({ ...grafanaFiring, alerts: [{ ...grafanaFiring.alerts[0], status }] });
    for (const status of ["firing", "resolved", "firing"]) {
      expect((await post(token, one(status))).status).toBe(202);
    }
    await ws.withShard((shard, sql) => {
      expect(shard.store.scan("incidents")).toMatchObject([{ status: "investigating" }]);
      const reopen = sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => JSON.parse(row.event) as BrigadeEvent)
        .filter((event) => event.type === "incident.status_changed")
        .at(-1)!;
      expect(reopen.data).toEqual({ from: "resolved", to: "investigating" });
      expect(asksForPage(reopen)).toBe(true);
    });
  });

  test("a dedup storm pages once", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana");
    const body = JSON.stringify({ ...grafanaFiring, alerts: [grafanaFiring.alerts[0]] });
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(token, body)));
    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(202));
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toHaveLength(1);
      expect(shard.store.scan("source_alerts")).toMatchObject([{ repeats: 19 }]);
    });
  });

  test("a malformed payload still pages instead of being silently dropped: it opens an incident through the default", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana", { name: "Grafana prod" });
    // Even a route that drops everything from this source does not swallow it.
    const sources = await ws.withShard((shard) => shard.store.scan("alert_sources"));
    expect(
      await ws.run("alertRoute.create", {
        id: newId("rte", Date.now(), random),
        name: "Drop everything",
        match: { sourceIds: [sources[0]!.id], severities: [], labels: [] },
        action: { kind: "drop" },
      }),
    ).toMatchObject({ ok: true });
    for (const body of ["{not json", JSON.stringify({ alerts: [] }), JSON.stringify([1, 2])]) {
      const response = await post(token, body);
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ ok: true, malformed: true });
    }
    await ws.withShard((shard, sql) => {
      // Three unreadable payloads are one alert, and one page.
      expect(pages(sql)).toEqual(["incident.declared by sys_alerts"]);
      expect(shard.store.scan("incidents")).toMatchObject([
        { title: "Unreadable alert from Grafana prod", severity: "sev2" },
      ]);
      expect(shard.store.scan("source_alerts")).toMatchObject([
        { dedupKey: "malformed", outcome: "opened", reason: "malformed", repeats: 2 },
      ]);
    });
  });

  test("an unmatched alert still pages through the default route", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana");
    expect(
      await ws.run("alertRoute.create", {
        id: newId("rte", Date.now(), random),
        name: "Search team only",
        match: { sourceIds: [], severities: [], labels: [{ key: "team", value: "search" }] },
        action: { kind: "suppress" },
      }),
    ).toMatchObject({ ok: true });
    await post(token, JSON.stringify(grafanaFiring));
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toHaveLength(2);
      expect(shard.store.scan("source_alerts").map((row) => row.reason)).toEqual([
        "default",
        "default",
      ]);
    });
  });

  test("a source's mapping names and ranks its incidents; one stored broken still pages as sent", async () => {
    const ws = await workspace();
    const { token, id } = await source(ws, "grafana");
    expect(
      await ws.run("alertSource.setMapping", {
        id,
        mapping: {
          titleTemplate: "{labels.zone} · {labels.alertname}",
          severity: {
            from: "label",
            label: "zone",
            rules: [{ value: "eu-1", severity: "critical" }],
            fallback: "warning",
          },
        },
      }),
    ).toMatchObject({ ok: true });
    expect((await post(token, JSON.stringify(grafanaFiring))).status).toBe(202);
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toHaveLength(2);
      const titles = shard.store
        .scan("incidents")
        .map((incident) => `${incident.severity} ${incident.title}`)
        .sort();
      expect(titles).toEqual(["sev1 eu-1 · High CPU usage", "sev3 us-1 · High memory usage"]);
      // Written by hand, never through the mutation: a template and a map nobody could save.
      shard.store.update("alert_sources", id, {
        mapping: {
          titleTemplate: "{labels.zone",
          severity: { from: "label", label: null, rules: [], fallback: "loud" },
        } as unknown as AlertMapping,
      });
    });
    const resent = {
      ...grafanaFiring,
      alerts: [{ ...grafanaFiring.alerts[0], fingerprint: "another-alert" }],
    };
    expect((await post(token, JSON.stringify(resent))).status).toBe(202);
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toHaveLength(3);
      expect(
        shard.store.scan("incidents").some(
          (incident) =>
            incident.title === "This alert was triggered for zone us-1" &&
            incident.severity === "sev1",
        ),
      ).toBe(true);
    });
  });

  test("a dropped alert records which route dropped it, and pages nobody", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana");
    const routeId = newId("rte", Date.now(), random);
    expect(
      await ws.run("alertRoute.create", {
        id: routeId,
        name: "Ignore the blue team",
        match: { sourceIds: [], severities: [], labels: [{ key: "team", value: "blue" }] },
        action: { kind: "drop" },
      }),
    ).toMatchObject({ ok: true });
    expect((await post(token, JSON.stringify(grafanaFiring))).status).toBe(202);
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toEqual([]);
      expect(outbox(sql).filter((line) => line.startsWith("alert."))).toEqual([
        "alert.dropped by sys_alerts",
        "alert.dropped by sys_alerts",
      ]);
      expect(shard.store.scan("source_alerts")).toMatchObject([
        { outcome: "dropped", routeId, routeName: "Ignore the blue team" },
        { outcome: "dropped", routeId, routeName: "Ignore the blue team" },
      ]);
    });
  });

  test("past the open-alert cap a new alert still pages: idle suppressed alerts make room", async () => {
    const ws = await workspace();
    const { token, id } = await source(ws, "generic");
    await ws.withShard((shard) => {
      // Fill the cap directly: 200 suppressed alerts firing, not sent for days.
      for (let i = 0; i < 200; i++) {
        shard.store.insert("source_alerts", {
          id: newId("alt", Date.now(), random),
          sourceId: id,
          dedupKey: `k${i}`,
          title: "Old",
          severity: "info",
          status: "firing",
          link: null,
          labels: {},
          outcome: "suppressed",
          reason: "matched",
          routeId: null,
          routeName: null,
          groupKey: null,
          policyId: null,
          incidentId: null,
          firedAt: 0,
          lastSeenAt: 0,
          resolvedAt: null,
          repeats: 0,
          updatedAt: 0,
        });
      }
    });
    const response = await post(token, JSON.stringify({ title: "One more", severity: "critical" }));
    expect(response.status).toBe(202);
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toEqual(["incident.declared by sys_alerts"]);
      expect(
        shard.store.scan("source_alerts").filter((row) => row.status === "firing"),
      ).toHaveLength(1);
    });
  });

  test("a Grafana group with one unreadable alert still pages the others, and the unreadable one", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "grafana");
    // A route that drops everything does not swallow the unreadable alert.
    expect(
      await ws.run("alertRoute.create", {
        id: newId("rte", Date.now(), random),
        name: "Drop the second",
        match: {
          sourceIds: [],
          severities: [],
          labels: [{ key: "alertname", value: "NoSuchAlert" }],
        },
        action: { kind: "drop" },
      }),
    ).toMatchObject({ ok: true });
    const [first, second] = grafanaFiring.alerts;
    const { fingerprint: _gone, ...broken } = second!;
    const response = await post(
      token,
      JSON.stringify({ ...grafanaFiring, alerts: [first, broken] }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, alerts: 2, malformed: false });
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toHaveLength(2);
      expect(
        shard.store
          .scan("source_alerts")
          .map((row) => row.reason)
          .sort(),
      ).toEqual(["default", "malformed"]);
    });
  });

  test("astral text in a title or a label key is fitted, not refused with a 503", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "generic");
    const fire = "🔥";
    const response = await post(
      token,
      JSON.stringify({ title: fire.repeat(150), labels: { [fire.repeat(60)]: "yes" } }),
    );
    expect(response.status).toBe(202);
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toHaveLength(1);
      expect(shard.store.scan("incidents")[0]!.title).toBe(fire.repeat(100));
    });
  });

  test("a payload the shard refuses pages the unreadable alert, never a 503 the sender retries forever", async () => {
    const ws = await workspace();
    const { id, token } = await source(ws, "grafana", { name: "Grafana prod" });
    const secret = token.split(".")[2]!;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const body = new TextEncoder().encode(JSON.stringify(grafanaFiring)).buffer as ArrayBuffer;
    const result = await ws.withShard(async (shard) => {
      let calls = 0;
      // The first ingest is refused as a deterministic `invalid_args` would be; the fallback goes through.
      const refusing = new Proxy(shard, {
        get(target, property) {
          if (property !== "mutate") return Reflect.get(target, property);
          return (input: Parameters<Shard["mutate"]>[0]) =>
            ++calls === 1
              ? {
                  result: { ok: false, error: { code: "invalid_args", message: "Refused" } },
                  changes: [],
                }
              : target.mutate(input);
        },
      });
      const intake = new AlertIntake({
        shard: refusing,
        randomBytes: random,
        log: () => {},
        committed: () => {},
        allow: async () => true,
      });
      return intake.receive(id, digest, body, {});
    });
    expect(result).toEqual({ status: "accepted", alerts: 1, malformed: true });
    await ws.withShard((shard, sql) => {
      expect(pages(sql)).toEqual(["incident.declared by sys_alerts"]);
      expect(shard.store.scan("incidents")[0]!.title).toBe("Unreadable alert from Grafana prod");
    });
  });
});

describe("constant-time comparison", () => {
  test("runs in workerd with its timingSafeEqual, and the fallback agrees", () => {
    const subtle: { timingSafeEqual?: unknown } = crypto.subtle;
    expect(typeof subtle.timingSafeEqual).toBe("function");
    const a = new Uint8Array([1, 2, 3]);
    expect(same(a, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(same(a, new Uint8Array([1, 2, 4]))).toBe(false);
    expect(same(a, new Uint8Array([1, 2]))).toBe(false);
  });
});

describe("taking an account back", () => {
  test("revokes its source URLs, disables the routes it created and routes what they kept quiet", async () => {
    const ws = await workspace();
    const { token } = await source(ws, "generic");
    const routeId = newId("rte", Date.now(), random);
    expect(
      await ws.run("alertRoute.create", {
        id: routeId,
        name: "Quiet everything",
        match: { sourceIds: [], severities: [], labels: [] },
        action: { kind: "suppress" },
      }),
    ).toMatchObject({ ok: true });
    expect((await post(token, JSON.stringify({ title: "Disk full" }))).status).toBe(202);
    await ws.withShard((_shard, sql) => expect(pages(sql)).toEqual([]));

    expect(await ws.stub.signOutUser(ws.id, owner.id, { takeOver: true })).toEqual({
      ok: true,
      paused: [],
      revoked: 0,
      sources: 1,
      routes: 1,
    });
    // The old URL is refused, the planted route is off, and the alert it suppressed pages now.
    expect((await post(token, JSON.stringify({ title: "Disk full" }))).status).toBe(404);
    await ws.withShard((shard, sql) => {
      expect(shard.store.get("alert_routes", routeId)?.disabled).toBe("takeover");
      expect(pages(sql)).toEqual(["incident.declared by sys_alerts"]);
    });
  });
});
