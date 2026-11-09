import { expect, test, vi } from "vite-plus/test";
import { emberTokens, primeToken, type TokenFetch } from "./ember-token";

const URL = "https://brigade.test/api/ember-token/org_test";
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

const answer =
  (status: number, body: unknown = null, seen: unknown[] = []): TokenFetch =>
  async (url, init) => {
    seen.push({ url, ...init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };

test("the first token is asked with the session in the Cookie header", async () => {
  const seen: unknown[] = [];
  expect(
    await primeToken(URL, "session=abc", answer(200, { token: "t1", expiresAt: T0 }, seen)),
  ).toEqual({ token: "t1", expiresAt: T0 });
  // A native fetch has no cookie jar of the session's.
  expect(seen).toMatchObject([
    { url: URL, method: "POST", headers: { Cookie: "session=abc" }, credentials: "omit" },
  ]);
});

test("no first token when refused, on a 5xx, a malformed answer, a failed fetch or no answer in time", async () => {
  for (const status of [401, 403, 404, 409, 503]) {
    expect(await primeToken(URL, "", answer(status))).toBeUndefined();
  }
  expect(await primeToken(URL, "", answer(200, { token: 1 }))).toBeUndefined();
  expect(
    await primeToken(URL, "", async () => {
      throw new TypeError("Network request failed");
    }),
  ).toBeUndefined();
  vi.useFakeTimers();
  try {
    const hanging = primeToken(URL, "", () => new Promise(() => {}), 5000);
    vi.advanceTimersByTime(5000);
    expect(await hanging).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test("a token request that hangs fails, so the client asks again", async () => {
  vi.useFakeTimers();
  try {
    const tokens = emberTokens({
      url: URL,
      cookie: () => "",
      fetch: () => new Promise(() => {}),
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

test("the client's tokens: the primed one first while it has a minute left, then one per ask", async () => {
  const seen: unknown[] = [];
  const tokens = emberTokens({
    url: URL,
    cookie: () => "session=abc",
    fetch: answer(200, { token: "t2", expiresAt: T0 + 300_000 }, seen),
    primed: { token: "t1", expiresAt: T0 + 300_000 },
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
    now: () => T0,
  });
  expect(await stale()).toBe("t2");
});

test("a refused session or membership is no token; a 5xx or an answer without one fails", async () => {
  const make = (status: number, body: unknown = null) =>
    emberTokens({ url: URL, cookie: () => "", fetch: answer(status, body) });
  expect(await make(401)()).toBeNull();
  expect(await make(403)()).toBeNull();
  await expect(make(409)()).rejects.toThrow("Ember token: 409");
  await expect(make(503)()).rejects.toThrow("Ember token: 503");
  await expect(make(200, {})()).rejects.toThrow("no token");
});
