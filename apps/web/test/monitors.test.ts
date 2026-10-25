import { newId, parseHeartbeatToken } from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import {
  checkDraft,
  EMPTY_DRAFT,
  formatLatency,
  formatSeconds,
  monitorBadge,
  newHeartbeat,
} from "../src/lib/monitors";

const id = () => newId("mon", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));

test("a paused monitor reads as paused, whatever its last status", () => {
  expect(monitorBadge({ paused: true, status: "down" })).toBe("paused");
  expect(monitorBadge({ paused: false, status: "down" })).toBe("down");
});

test("intervals and latencies in both locales", () => {
  expect([30, 90, 300, 3600, 86_400].map((s) => formatSeconds(s, "en"))).toEqual([
    "30 sec",
    "90 sec",
    "5 min",
    "1 hr",
    "1 day",
  ]);
  expect(formatSeconds(300, "pt-BR")).toBe("5 min");
  expect(formatLatency(1284, "en")).toBe("1,284 ms");
  expect(formatLatency(1284, "pt-BR")).toBe("1.284 ms");
});

test("an HTTP draft becomes createHttp's args, checked by its own validator", () => {
  const checked = checkDraft(
    { ...EMPTY_DRAFT, name: " Checkout ", url: "https://example.com" },
    id(),
  );
  expect(checked).toMatchObject({
    ok: true,
    kind: "http",
    args: {
      name: "Checkout",
      url: "https://example.com/",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 10,
      regions: ["enam", "weur"],
    },
  });
});

test("the fields the shard would refuse are named, a private URL among them", () => {
  const checked = checkDraft(
    {
      ...EMPTY_DRAFT,
      name: "",
      url: "http://192.168.1.1/",
      expectedStatus: "abc",
      intervalSeconds: "10",
      regions: [],
    },
    id(),
  );
  expect(checked.ok ? [] : [...checked.fields].sort()).toEqual(
    ["expectedStatus", "intervalSeconds", "name", "regions", "url"].sort(),
  );
  const slow = checkDraft(
    {
      ...EMPTY_DRAFT,
      name: "A",
      url: "https://example.com",
      intervalSeconds: "30",
      timeoutSeconds: "30",
    },
    id(),
  );
  expect(slow.ok).toBe(true);
  // A keyword is dropped for HEAD, which has no body.
  const head = checkDraft(
    { ...EMPTY_DRAFT, name: "A", url: "https://example.com", method: "HEAD", keyword: "ok" },
    id(),
  );
  expect(head).toMatchObject({ ok: true, args: { method: "HEAD", keyword: null } });
});

test("a heartbeat URL carries the workspace, the monitor and a secret whose hash is sent", async () => {
  const monitorId = id();
  const { tokenHash, url } = await newHeartbeat(
    "https://brigade.example.com",
    "ws_demo",
    monitorId,
  );
  expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  const prefix = "https://brigade.example.com/api/heartbeat/";
  expect(url.startsWith(prefix)).toBe(true);
  const parsed = parseHeartbeatToken(url.slice(prefix.length));
  expect(parsed).toMatchObject({ workspaceId: "ws_demo", monitorId });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parsed!.secret));
  expect([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(
    tokenHash,
  );
  expect(checkDraft({ ...EMPTY_DRAFT, kind: "heartbeat", name: "Backup" }, id())).toMatchObject({
    ok: true,
    kind: "heartbeat",
    args: { intervalSeconds: 60, graceSeconds: 300 },
  });
});
