import { beforeEach, expect, test, vi } from "vite-plus/test";

vi.mock("@/lib/auth-client", () => ({ server: undefined }));

const { loadSignUpMode, resetSignUpMode } = await import("./sign-up-mode");

beforeEach(() => resetSignUpMode());

const URL = "https://brigade.example.com/api/config";
const answer = (body: unknown) => vi.fn(() => Promise.resolve(Response.json(body)));

test.each([
  [{ signUp: "open" }, "open"],
  [{ signUp: "invite" }, "invite"],
  [{ signUp: "closed" }, "closed"],
  [{ signUp: "anything" }, "closed"],
] as const)("%o reads as %s", async (body, mode) => {
  const fetcher = answer(body);
  await expect(loadSignUpMode(URL, fetcher as unknown as typeof fetch)).resolves.toBe(mode);
  expect(fetcher).toHaveBeenCalledWith(URL, expect.anything());
});

test("no server, or no answer, reads as closed; a failure is asked again", async () => {
  await expect(loadSignUpMode(undefined)).resolves.toBe("closed");
  const failing = vi.fn(() => Promise.resolve(new Response(null, { status: 503 })));
  await expect(loadSignUpMode(URL, failing as unknown as typeof fetch)).resolves.toBe("closed");
  const open = answer({ signUp: "open" });
  await expect(loadSignUpMode(URL, open as unknown as typeof fetch)).resolves.toBe("open");
  await expect(loadSignUpMode(URL, open as unknown as typeof fetch)).resolves.toBe("open");
  expect(open).toHaveBeenCalledTimes(1);
});
