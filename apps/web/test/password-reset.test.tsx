// @vitest-environment happy-dom
// Password reset in the dashboard (RFC 0002 "Auth"): how the API's answers read, the "Forgot your password?" page
// (the same "check your email" for any address), and the reset page (its token out of the address bar at once, the
// length rule before sending, the expired or used link, and the end state).
import { setLocale } from "@freecorps/brigade-i18n";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { PreferencesProvider } from "../src/components/preferences";
import {
  requestPasswordReset,
  resetPassword,
  resetToken,
  resetTokenFromHash,
} from "../src/lib/password-reset";
import { routeTree } from "../src/routeTree.gen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every request the pages make, answered by the test's `reply` (signed out: no session). Set before the modules
 * load, since the Better Auth client keeps the `fetch` it found then.
 */
const network = vi.hoisted(() => {
  const state = {
    requests: [] as { url: string; body: unknown }[],
    reply: (_url: string): Response => Response.json({}),
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    state.requests.push({ url, body });
    if (url.includes("/get-session")) return Response.json(null);
    return state.reply(url);
  };
  return state;
});

const answer =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    Response.json(body, { status });

describe("the API client", () => {
  test("asking: the same `sent` for any address; limits, no email and failures told apart", async () => {
    expect(await requestPasswordReset("ana@example.com", answer(200, { status: true }))).toBe(
      "sent",
    );
    expect(await requestPasswordReset("ana@example.com", answer(429, {}))).toBe("rate_limited");
    expect(
      await requestPasswordReset("ana@example.com", answer(503, { code: "EMAIL_NOT_CONFIGURED" })),
    ).toBe("not_configured");
    expect(await requestPasswordReset("ana@example.com", answer(500, {}))).toBe("failed");
    const offline: typeof fetch = async () => {
      throw new TypeError("offline");
    };
    expect(await requestPasswordReset("ana@example.com", offline)).toBe("failed");
  });

  test("resetting: done, a dead link, the length rule, limits and failures", async () => {
    expect(await resetPassword("t", "long enough", answer(200, { status: true }))).toBe("done");
    expect(await resetPassword("t", "x", answer(400, { code: "INVALID_TOKEN" }))).toBe("invalid");
    expect(await resetPassword("t", "x", answer(400, { code: "PASSWORD_TOO_SHORT" }))).toBe(
      "too_short",
    );
    expect(await resetPassword("t", "x", answer(400, { code: "PASSWORD_TOO_LONG" }))).toBe(
      "too_long",
    );
    expect(await resetPassword("t", "x", answer(429, {}))).toBe("rate_limited");
    // The server failed, maybe after saving the password: not "try again".
    expect(await resetPassword("t", "x", answer(502, {}))).toBe("uncertain");
  });

  test("the token: Better Auth's alphabet, bounded, read from the fragment", () => {
    expect(resetToken("Ab3_x-9QwErTyUiOpAsDfGhJ")).toBe("Ab3_x-9QwErTyUiOpAsDfGhJ");
    expect(resetTokenFromHash("#token=Ab3_x-9QwErTyUiOpAsDfGhJ")).toBe("Ab3_x-9QwErTyUiOpAsDfGhJ");
    expect(resetTokenFromHash("token=Ab3_x")).toBe("Ab3_x");
    expect(resetTokenFromHash("")).toBe(undefined);
    expect(resetTokenFromHash("#token=<script>")).toBe(undefined);
    for (const value of ["", "a b", "<script>", "a".repeat(129), 42, undefined]) {
      expect(resetToken(value), String(value)).toBe(undefined);
    }
  });
});

let root: Root | undefined;

beforeEach(() => {
  void setLocale("en");
  network.requests = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Opens the dashboard at `path` with other requests answered by `reply`; answers the router, to read where it is. */
async function open(path: string, reply: (url: string) => Response) {
  network.reply = reply;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PreferencesProvider initialLocale="en">
        <RouterProvider router={router} />
      </PreferencesProvider>,
    );
  });
  await settle();
  return router;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

const heading = () => document.querySelector("h1")?.textContent;
const input = (label: string) =>
  [...document.querySelectorAll("label")]
    .find((one) => one.textContent === label)
    ?.parentElement?.querySelector("input") as HTMLInputElement;

async function type(element: HTMLInputElement, value: string) {
  await act(async () => {
    // The prototype's setter, with the input as receiver, as React's value tracker listens for it.
    Reflect.set(HTMLInputElement.prototype, "value", value, element);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    document.querySelector("form")!.requestSubmit();
  });
  await settle();
}

const asked = (path: string) => network.requests.filter((one) => one.url.endsWith(path));

describe("the sign-in page", () => {
  test("leads to the forgot-password page", async () => {
    await open("/sign-in", () => Response.json({}));
    const link = [...document.querySelectorAll("a")].find(
      (one) => one.textContent === "Forgot your password?",
    );
    expect(link?.getAttribute("href")).toBe("/forgot-password");
  });
});

describe("the forgot-password page", () => {
  test("checks the address, then says the same for any address", async () => {
    await open("/forgot-password", () => Response.json({ status: true }));
    expect(heading()).toBe("Reset your password");
    await type(input("Email"), "ana");
    await submit();
    expect(document.body.textContent).toContain("Enter an email address like name@example.com.");
    expect(asked("/request-password-reset")).toHaveLength(0);

    const email = "bartholomew.fitzgerald@northwind-industries-holdings.example.com";
    await type(input("Email"), ` ${email} `);
    await submit();
    expect(asked("/request-password-reset").map((one) => one.body)).toEqual([{ email }]);
    expect(heading()).toBe("Check your email");
    expect(document.body.textContent).toContain(`If ${email} has a Brigade account`);
  });

  test("a limit or a server without email is said in place", async () => {
    await open("/forgot-password", () => Response.json({}, { status: 429 }));
    await type(input("Email"), "ana@example.com");
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Too many links asked for this address. Try again in an hour.",
    );
    expect(heading()).toBe("Reset your password");
  });
});

describe("the reset page", () => {
  test("takes the token out of the address bar, checks the length, then saves", async () => {
    const router = await open("/reset-password#token=Ab3xQwErTyUiOpAsDfGhJkLz", () =>
      Response.json({ status: true }),
    );
    expect(router.state.location.href).toBe("/reset-password");
    expect(heading()).toBe("Choose a new password");

    await type(input("New password"), "short");
    await submit();
    expect(document.body.textContent).toContain("Use at least 8 characters.");
    expect(asked("/reset-password")).toHaveLength(0);

    await type(input("New password"), "correct horse battery staple");
    await submit();
    expect(asked("/reset-password").map((one) => one.body)).toEqual([
      { token: "Ab3xQwErTyUiOpAsDfGhJkLz", newPassword: "correct horse battery staple" },
    ]);
    expect(heading()).toBe("Password changed");
    // Paging stops with the sessions: said before the person walks away from a phone that is now quiet.
    expect(document.body.textContent).toContain(
      "Your phones get no pages until you sign in to the app again.",
    );
    expect(document.querySelector('a[href="/sign-in"]')).not.toBeNull();
  });

  test("an expired or used link asks for a new one", async () => {
    await open("/reset-password#token=Ab3xQwErTyUiOpAsDfGhJkLz", () =>
      Response.json({ code: "INVALID_TOKEN" }, { status: 400 }),
    );
    await type(input("New password"), "correct horse battery staple");
    await submit();
    expect(heading()).toBe("This link doesn't work");
    expect(document.querySelector('a[href="/forgot-password"]')?.textContent).toBe(
      "Send a new link",
    );
  });

  test("a server failure after the password may be saved says so, not to try the link again", async () => {
    await open("/reset-password#token=Ab3xQwErTyUiOpAsDfGhJkLz", () =>
      Response.json({}, { status: 500 }),
    );
    await type(input("New password"), "correct horse battery staple");
    await submit();
    expect(document.body.textContent).toContain("it may already be saved");
    expect(document.body.textContent).not.toContain("Could not reach Brigade");
  });

  test("without a token there is nothing to save", async () => {
    await open("/reset-password", () => Response.json({}));
    expect(heading()).toBe("This link doesn't work");
    expect(document.querySelector("form")).toBeNull();
  });

  test("reads in pt-BR", async () => {
    void setLocale("pt-BR");
    await open("/reset-password#token=Ab3xQwErTyUiOpAsDfGhJkLz", () => Response.json({}));
    expect(heading()).toBe("Escolha uma nova senha");
  });
});
