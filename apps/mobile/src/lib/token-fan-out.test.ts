// A paging path (AGENTS.md): a new APNs or FCM token must reach every instance on the phone (RFC 0015 section 5), or
// the others keep paging a dead token.
import { expect, test } from "vite-plus/test";
import { knownTokens, tokenFanOut } from "./paging";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const tokens = knownTokens();
  let heard: ((token: { data: unknown }) => void) | null = null;
  let listening = 0;
  const fanOut = tokenFanOut(tokens, (listener) => {
    heard = listener;
    listening += 1;
    return () => {
      heard = null;
      listening -= 1;
    };
  });
  const nudges = { a: 0, b: 0 };
  const leaveA = fanOut.add({ nudge: () => (nudges.a += 1) });
  const leaveB = fanOut.add({ nudge: () => (nudges.b += 1) });
  return {
    tokens,
    nudges,
    hear: (token: string) => heard?.({ data: token }),
    hearRaw: (data: unknown) => heard?.({ data }),
    listening: () => listening,
    leaveA,
    leaveB,
  };
}

test("a rotated token heard by the listener nudges both instances; the same token nudges neither", async () => {
  const at = setup();
  expect(at.listening()).toBe(1);
  await at.tokens.fetch(async () => OLD);
  at.hear(OLD);
  await flush();
  expect(at.nudges).toEqual({ a: 0, b: 0 });
  at.hear(NEW);
  await flush();
  expect(at.nudges).toEqual({ a: 1, b: 1 });
  at.hear(NEW);
  await flush();
  expect(at.nudges).toEqual({ a: 1, b: 1 });
});

test("a new token one instance's registration fetched first still reaches the other", async () => {
  const at = setup();
  await at.tokens.fetch(async () => OLD);
  // Instance A registers and fetches the rotated token before the listener's event is compared.
  await at.tokens.fetch(async () => NEW);
  at.hear(NEW);
  await flush();
  expect(at.nudges.b).toBe(1);
});

test("one platform listener, removed when the last instance leaves", () => {
  const at = setup();
  at.leaveA();
  expect(at.listening()).toBe(1);
  at.leaveB();
  expect(at.listening()).toBe(0);
});

test("a listener event without a token string changes nothing", async () => {
  const at = setup();
  await at.tokens.fetch(async () => OLD);
  for (const data of [undefined, null, {}, 1, ""]) at.hearRaw(data);
  await flush();
  expect(at.nudges).toEqual({ a: 0, b: 0 });
});
