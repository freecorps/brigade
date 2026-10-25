import { setLocale } from "@freecorps/brigade-i18n";
import { WORKSPACE_NAME_MAX } from "@freecorps/brigade-schema";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import {
  authErrorMessage,
  checkSignIn,
  checkSignUp,
  checkWorkspaceName,
  createWorkspace,
  PASSWORD_MIN,
} from "../src/lib/auth";

beforeEach(() => {
  void setLocale("en");
});

const valid = {
  name: "Ana Souza",
  email: "ana@example.com",
  password: "correct horse battery staple",
  workspace: "Platform team",
};

describe("sign-up and sign-in checks", () => {
  test("a complete form passes", () => {
    expect(checkSignUp(valid)).toEqual({});
    expect(checkSignIn(valid)).toEqual({});
  });

  test("every empty field is reported at once", () => {
    expect(checkSignUp({ name: " ", email: "", password: "", workspace: "  " })).toEqual({
      name: "Fill in this field.",
      email: "Fill in this field.",
      password: "Fill in this field.",
      workspace: "Fill in this field.",
    });
  });

  test("emails need an @ and a dot after it; passwords need the minimum length", () => {
    for (const email of ["ana", "ana@example", "ana @example.com", "@example.com"]) {
      expect(checkSignUp({ ...valid, email }).email, email).toBe(
        "Enter an email address like name@example.com.",
      );
    }
    expect(checkSignUp({ ...valid, password: "x".repeat(PASSWORD_MIN - 1) }).password).toBe(
      "Use at least 8 characters.",
    );
    // Sign-in does not judge the password's length: old accounts may predate a policy.
    expect(checkSignIn({ email: valid.email, password: "short" })).toEqual({});
  });

  test("the workspace name follows the shard's own validator", () => {
    expect(checkWorkspaceName("  Platform team  ")).toEqual({ ok: true, name: "Platform team" });
    // Only invisible characters: a zero-width space and a right-to-left override.
    const invisible = String.fromCodePoint(0x200b, 0x202e);
    expect(checkWorkspaceName(invisible)).toEqual({
      ok: false,
      error: "A name needs visible text: invisible characters alone don't count.",
    });
    expect(checkWorkspaceName("x".repeat(WORKSPACE_NAME_MAX + 1)).ok).toBe(false);
  });

  test("messages follow the locale", async () => {
    await setLocale("pt-BR");
    expect(checkSignIn({ email: "", password: "" }).email).toBe("Preencha este campo.");
  });
});

describe("server failures", () => {
  test.each([
    [
      { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
      "sign-in",
      "That email and password do not match an account.",
    ],
    [
      { status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" },
      "sign-up",
      "An account with this email already exists. Sign in instead.",
    ],
    [{ status: 429 }, "sign-in", "Too many attempts. Wait a minute and try again."],
    [null, "sign-up", "Could not reach Brigade. Check your connection and try again."],
    [{ status: 500 }, "sign-in", "Something went wrong. Try again."],
  ] as const)("%o during %s", (error, during, message) => {
    expect(authErrorMessage(error, during)).toBe(message);
  });
});

describe("createWorkspace", () => {
  const answer = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });

  test("posts the name and returns the workspace", async () => {
    let sent: { url: string; init?: RequestInit } | undefined;
    const fetcher = (async (url: string, init?: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ id: "ws_1", name: "Platform team" }), { status: 201 });
    }) as typeof fetch;
    expect(await createWorkspace("Platform team", fetcher)).toEqual({
      ok: true,
      workspace: { id: "ws_1", name: "Platform team" },
    });
    expect(sent?.url).toBe("/api/workspaces");
    expect(sent?.init?.method).toBe("POST");
    expect(JSON.parse(sent?.init?.body as string)).toEqual({ name: "Platform team" });
  });

  test("a refusal, a malformed answer and a network failure are failures", async () => {
    expect(await createWorkspace("x", answer(401, {}) as typeof fetch)).toEqual({
      ok: false,
      status: 401,
    });
    expect(await createWorkspace("x", answer(201, { id: 1 }) as typeof fetch)).toEqual({
      ok: false,
      status: 502,
    });
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await createWorkspace("x", offline)).toEqual({ ok: false, status: 0 });
  });
});
