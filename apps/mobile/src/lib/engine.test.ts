import { expect, test, vi } from "vite-plus/test";
import {
  chosenEngine,
  emberTokens,
  engineRecord,
  probeEngine,
  rememberedEngine,
  type EngineFetch,
} from "./engine";

const URL = "https://brigade.test/api/ember-token/org_test";
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

const answer =
  (status: number, body: unknown = null, seen: unknown[] = []): EngineFetch =>
  async (url, init) => {
    seen.push({ url, ...init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };

test("a token means Ember, and is the client's first; 409 and 404 mean Brigade Sync, remembered", async () => {
  const seen: unknown[] = [];
  expect(
    await probeEngine(URL, "session=abc", answer(200, { token: "t1", expiresAt: T0 }, seen)),
  ).toEqual({ engine: "ember", minted: { token: "t1", expiresAt: T0 } });
  // The session in the `Cookie` header: a native fetch has no cookie jar of the session's.
  expect(seen).toMatchObject([
    { url: URL, method: "POST", headers: { Cookie: "session=abc" }, credentials: "omit" },
  ]);
  expect(await probeEngine(URL, "", answer(409))).toEqual({ engine: "brigade", remember: true });
  expect(await probeEngine(URL, "", answer(404))).toEqual({ engine: "brigade", remember: true });
});

test("a refused session is Brigade Sync, whose socket says so, and is not remembered", async () => {
  expect(await probeEngine(URL, "", answer(401))).toEqual({ engine: "brigade", remember: false });
  expect(await probeEngine(URL, "", answer(403))).toEqual({ engine: "brigade", remember: false });
});

test("no answer, a 5xx or a malformed one: the engine last known, else Brigade Sync", async () => {
  expect(await probeEngine(URL, "", answer(503))).toEqual({ engine: undefined });
  expect(await probeEngine(URL, "", answer(200, { token: 1 }))).toEqual({ engine: undefined });
  expect(
    await probeEngine(URL, "", async () => {
      throw new TypeError("Network request failed");
    }),
  ).toEqual({ engine: undefined });
  vi.useFakeTimers();
  try {
    const hanging = probeEngine(URL, "", () => new Promise(() => {}), 5000);
    vi.advanceTimersByTime(5000);
    expect(await hanging).toEqual({ engine: undefined });
  } finally {
    vi.useRealTimers();
  }
  expect(chosenEngine({ engine: undefined }, "ember")).toBe("ember");
  expect(chosenEngine({ engine: undefined }, null)).toBe("brigade");
  expect(chosenEngine({ engine: "brigade", remember: true }, "ember")).toBe("brigade");
});

test("the engine is remembered per member and workspace", () => {
  let raw = engineRecord(null, "usr_ana", "org_a", "ember");
  raw = engineRecord(raw, "usr_ana", "org_b", "brigade");
  expect(rememberedEngine(raw, "usr_ana", "org_a")).toBe("ember");
  expect(rememberedEngine(raw, "usr_ana", "org_b")).toBe("brigade");
  expect(rememberedEngine(raw, "usr_bia", "org_a")).toBeNull();
  expect(rememberedEngine(raw, "usr_ana", "org_other")).toBeNull();
  // Another member's record is not carried over.
  expect(
    rememberedEngine(engineRecord(raw, "usr_bia", "org_c", "ember"), "usr_bia", "org_a"),
  ).toBeNull();
  expect(rememberedEngine("not json", "usr_ana", "org_a")).toBeNull();
  expect(rememberedEngine(null, "usr_ana", "org_a")).toBeNull();
});

test("a token request that hangs fails, so the client asks again", async () => {
  vi.useFakeTimers();
  try {
    const tokens = emberTokens({
      url: URL,
      cookie: () => "",
      fetch: () => new Promise(() => {}),
      onTurnedBack: () => {},
      timeoutMs: 1000,
    });
    const asked = tokens();
    const failed = expect(asked).rejects.toThrow("no answer in time");
    vi.advanceTimersByTime(1000);
    await failed;
  } finally {
    vi.useRealTimers();
  }
});

test("the client's tokens: the probe's first while it has a minute left, then one per ask", async () => {
  const seen: unknown[] = [];
  const onTurnedBack = vi.fn();
  const tokens = emberTokens({
    url: URL,
    cookie: () => "session=abc",
    fetch: answer(200, { token: "t2", expiresAt: T0 + 300_000 }, seen),
    primed: { token: "t1", expiresAt: T0 + 300_000 },
    onTurnedBack,
    now: () => T0,
  });
  expect(await tokens()).toBe("t1");
  expect(seen).toHaveLength(0);
  expect(await tokens()).toBe("t2");
  expect(seen).toHaveLength(1);

  const stale = emberTokens({
    url: URL,
    cookie: () => "",
    fetch: answer(200, { token: "t2", expiresAt: T0 + 300_000 }),
    primed: { token: "t1", expiresAt: T0 + 30_000 },
    onTurnedBack,
    now: () => T0,
  });
  expect(await stale()).toBe("t2");
  expect(onTurnedBack).not.toHaveBeenCalled();
});

test("turned back to WorkspaceDO: no token, and the app opens it again on Brigade Sync", async () => {
  const onTurnedBack = vi.fn();
  const make = (status: number, body: unknown = null) =>
    emberTokens({ url: URL, cookie: () => "", fetch: answer(status, body), onTurnedBack });
  expect(await make(409)()).toBeNull();
  expect(onTurnedBack).toHaveBeenCalledTimes(1);
  expect(await make(401)()).toBeNull();
  expect(await make(403)()).toBeNull();
  await expect(make(503)()).rejects.toThrow("Ember token: 503");
  await expect(make(200, {})()).rejects.toThrow("no token");
  expect(onTurnedBack).toHaveBeenCalledTimes(1);
});
