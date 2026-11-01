import { afterEach, expect, test, vi } from "vite-plus/test";

// `@better-auth/expo` runs on React Native; in Node it needs only these (as in src/lib/auth-client.test.ts).
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "brigade" }, platform: {} } }));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `brigade://${path}` }));
vi.mock("expo-secure-store", () => ({}));
vi.stubGlobal("__DEV__", false);

const { brigadeAuthClient, storeSessionCookie } = await import("./auth-client");
const { DEFAULT_INSTANCE, instanceStorage } = await import("./instances");
const { POLL_GRACE_MS, POLL_INTERVAL_MS, readPoll, runClaim } = await import("./qr-sign-in");
type ClaimState = import("./qr-sign-in").ClaimState;

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORIGIN = "https://brigade.acme.example";
const CODE = "AbCdEfGhIjKlMnOpQrSt_-";
const CLAIM_ID = "asi_01JD0000000000000000000000";
const SECRET = "s".repeat(43);
const START = Date.parse("2026-11-01T12:00:00.000Z");
const COOKIE =
  "__Secure-better-auth.session_token=tok.sig; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax";
const USER = { id: "usr_1", name: "Ana Souza", email: "ana@acme.example" };

function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    getItemAsync: async (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    setItemAsync: async (key: string, value: string) => void items.set(key, value),
  };
}

type Answer = { status: number; body: unknown };

/** A server that answers the claim with `claim` and each poll with the next of `polls` (the last repeats). */
function server(claim: Answer, polls: (Answer | Error)[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  let polled = 0;
  const clock = { now: START };
  const fetch = async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const answer = url.endsWith("/claim") ? claim : polls[Math.min(polled++, polls.length - 1)]!;
    if (answer instanceof Error) throw answer;
    return {
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      json: async () => answer.body,
    };
  };
  return { fetch, seen, clock };
}

const CLAIMED: Answer = {
  status: 201,
  body: {
    claimId: CLAIM_ID,
    secret: SECRET,
    number: "37",
    expiresAt: new Date(START + 120_000).toISOString(),
  },
};
const PENDING: Answer = {
  status: 200,
  body: { status: "pending", expiresAt: new Date(START + 120_000).toISOString() },
};
const APPROVED: Answer = {
  status: 200,
  body: {
    status: "approved",
    session: { cookie: COOKIE, expiresAt: "2026-11-08T12:00:00.000Z" },
    user: USER,
  },
};
const expired = (reason: string): Answer => ({ status: 200, body: { status: "expired", reason } });

function run(
  fake: ReturnType<typeof server>,
  store: (cookie: string) => Promise<void> = async () => {},
  cancelled = () => false,
) {
  const states: ClaimState[] = [];
  const done = runClaim(
    { origin: ORIGIN, code: CODE, deviceName: "Ana's iPhone", platform: "ios" },
    {
      fetch: fake.fetch,
      now: () => fake.clock.now,
      sleep: async (ms) => {
        fake.clock.now += ms;
      },
      store,
      onState: (state) => states.push(state),
      cancelled,
    },
  );
  return { done, states };
}

test("claims with the code, the device name and the platform, then shows the number", async () => {
  const fake = server(CLAIMED, [PENDING, expired("denied")]);
  const { done, states } = run(fake);
  await done;
  const claim = fake.seen[0]!;
  expect(claim.url).toBe(`${ORIGIN}/api/app-sign-in/claim`);
  expect(claim.init.method).toBe("POST");
  expect(JSON.parse(claim.init.body as string)).toEqual({
    code: CODE,
    deviceName: "Ana's iPhone",
    platform: "ios",
  });
  expect(states[0]).toEqual({ step: "claiming" });
  expect(states[1]).toEqual({ step: "waiting", number: "37", expiresAt: START + 120_000 });
  // Polls carry the secret only the phone got.
  const poll = fake.seen[1]!;
  expect(poll.url).toBe(`${ORIGIN}/api/app-sign-in/claim/${CLAIM_ID}`);
  expect(new Headers(poll.init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
});

test("each expired reason ends it with that reason, storing nothing", async () => {
  for (const reason of ["denied", "wrong_number", "timeout", "delivered", "signed_out"]) {
    const store = vi.fn(async () => {});
    const fake = server(CLAIMED, [PENDING, PENDING, expired(reason)]);
    const { done, states } = run(fake, store);
    expect(await done, reason).toEqual({ step: "ended", reason });
    expect(states.at(-1)).toEqual({ step: "ended", reason });
    expect(store).not.toHaveBeenCalled();
  }
  // A reason this app does not know yet still ends it.
  expect(readPoll(200, { status: "expired", reason: "new_reason" })).toEqual({
    kind: "ended",
    reason: "timeout",
  });
});

test("a claim refused: invalid code, rate limited, no answer", async () => {
  const cases: [Answer | Error, string][] = [
    [{ status: 404, body: { error: "invalid_code" } }, "invalid_code"],
    [{ status: 429, body: { error: "rate_limited" } }, "rate_limited"],
    [{ status: 503, body: { error: "unavailable" } }, "unreachable"],
    [{ status: 201, body: { claimId: "nope" } }, "unreachable"],
  ];
  for (const [answer, reason] of cases) {
    const fake = server(answer as Answer, [PENDING]);
    const { done } = run(fake);
    expect(await done, reason).toEqual({ step: "ended", reason });
    expect(fake.seen).toHaveLength(1);
  }
  const offline = server(CLAIMED, [PENDING]);
  offline.fetch = async () => {
    throw new TypeError("Network request failed");
  };
  expect(await run(offline).done).toEqual({ step: "ended", reason: "unreachable" });
});

test("no answer while waiting keeps asking until the claim's time is up", async () => {
  const fake = server(CLAIMED, [new TypeError("offline"), { status: 503, body: {} }]);
  const { done } = run(fake);
  expect(await done).toEqual({ step: "ended", reason: "timeout" });
  // Asked every interval for the claim's 2 minutes and the grace after.
  const polls = fake.seen.length - 1;
  expect(polls).toBe(Math.floor((120_000 + POLL_GRACE_MS) / POLL_INTERVAL_MS) + 1);
});

test("an approval moves the end: the phone keeps asking past the first expiresAt", async () => {
  const later = {
    status: 200,
    body: { status: "pending", expiresAt: new Date(START + 600_000).toISOString() },
  };
  const fake = server(CLAIMED, [
    later,
    ...Array(80)
      .fill(PENDING)
      .map(() => later),
    APPROVED,
  ]);
  const { done } = run(fake);
  expect((await done).step).toBe("signed-in");
});

test("a claim the server no longer knows ends as lost", async () => {
  const fake = server(CLAIMED, [{ status: 404, body: { error: "not_found" } }]);
  expect(await run(fake).done).toEqual({ step: "ended", reason: "lost" });
});

test("leaving the screen stops asking", async () => {
  let left = false;
  const fake = server(CLAIMED, [PENDING]);
  const store = vi.fn(async () => {});
  const states: ClaimState[] = [];
  const done = runClaim(
    { origin: ORIGIN, code: CODE, deviceName: "x", platform: "android" },
    {
      fetch: fake.fetch,
      now: () => fake.clock.now,
      sleep: async (ms) => {
        fake.clock.now += ms;
        if (fake.clock.now > START + 10_000) left = true;
      },
      store,
      onState: (state) => states.push(state),
      cancelled: () => left,
    },
  );
  await done;
  expect(store).not.toHaveBeenCalled();
  expect(states.some((state) => state.step === "ended")).toBe(false);
});

test("approved: the session is stored for the claim's instance, never for another", async () => {
  const storage = memoryStore();
  // The build's default instance is signed in as someone else on this phone.
  const before = JSON.stringify({
    "better-auth.session_token": { value: "default.sig", expires: "2999-01-01T00:00:00.000Z" },
  });
  storage.items.set("brigade_cookie", before);
  // Someone's last session read at Acme, from before.
  storage.items.set("brigade_acme1_session_data", JSON.stringify({ user: { id: "old" } }));
  vi.stubGlobal("fetch", vi.fn());
  const acme = instanceStorage("acme1").auth;
  const fake = server(CLAIMED, [PENDING, APPROVED]);
  const { done, states } = run(fake, (cookie) => storeSessionCookie(storage, acme, cookie));
  expect(await done).toEqual({ step: "signed-in", user: USER });
  expect(states.at(-1)).toEqual({ step: "signed-in", user: USER });

  // Stored as @better-auth/expo stores a sign-in's cookie, under Acme's prefix.
  const kept = JSON.parse(storage.items.get("brigade_acme1_cookie")!);
  expect(kept["__Secure-better-auth.session_token"].value).toBe("tok.sig");
  expect(storage.items.get("brigade_acme1_session_data")).toBe("{}");
  const acmeClient = brigadeAuthClient(`${ORIGIN}/api/auth`, storage, acme);
  expect(await acmeClient.getCookie()).toBe("__Secure-better-auth.session_token=tok.sig");
  // The default instance's session is untouched, and no other key was written.
  expect(storage.items.get("brigade_cookie")).toBe(before);
  const other = brigadeAuthClient(
    "https://brigade.test/api/auth",
    storage,
    instanceStorage(DEFAULT_INSTANCE).auth,
  );
  expect(await other.getCookie()).toBe("better-auth.session_token=default.sig");
  expect([...storage.items.keys()].sort()).toEqual([
    "brigade_acme1_cookie",
    "brigade_acme1_session_data",
    "brigade_cookie",
  ]);
});

test("approved but the session cannot be kept: said, not signed in", async () => {
  const fake = server(CLAIMED, [APPROVED]);
  const { done } = run(fake, async () => {
    throw new Error("Keychain locked");
  });
  expect(await done).toEqual({ step: "ended", reason: "not_stored" });
  // An answer with no cookie in it stores nothing either.
  const storage = memoryStore();
  await expect(storeSessionCookie(storage, "brigade:x", "other=1; Max-Age=0")).rejects.toThrow();
  // An approval this app cannot read.
  expect(readPoll(200, { status: "approved", session: {}, user: USER })).toEqual({
    kind: "ended",
    reason: "not_stored",
  });
});
