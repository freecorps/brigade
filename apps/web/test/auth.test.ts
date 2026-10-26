import { setLocale } from "@freecorps/brigade-i18n";
import { WORKSPACE_NAME_MAX } from "@freecorps/brigade-schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  authErrorMessage,
  checkSignIn,
  checkSignUp,
  checkWorkspaceName,
  createWorkspace,
  makeAuthClient,
  NAME_MAX,
  openWorkspace,
  PASSWORD_MAX,
  PASSWORD_MIN,
  saveLocale,
} from "../src/lib/auth";
import { pageTitle } from "../src/lib/page-title";

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

  test("names follow the API's rule: joiners between letters, never bidi controls", () => {
    const cp = (...points: number[]) => String.fromCodePoint(...points);
    expect(checkSignUp({ ...valid, name: `نسرین${cp(0x200c)}دخت` }).name).toBeUndefined();
    for (const name of [`Ana${cp(0x202e)}`, `${cp(0x200d)}Ana`]) {
      expect(checkSignUp({ ...valid, name }).name, JSON.stringify(name)).toBe(
        "Remove invisible, control or bidi characters from the name.",
      );
    }
    expect(authErrorMessage({ status: 400, code: "INVALID_NAME" }, "sign-up")).toBe(
      "Remove invisible, control or bidi characters from the name.",
    );
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
    expect(checkWorkspaceName("x".repeat(WORKSPACE_NAME_MAX)).ok).toBe(true);
  });

  test("too-long names and passwords get their own error (the inputs do not cut them short)", () => {
    const long = checkSignUp({
      ...valid,
      name: "N".repeat(NAME_MAX + 1),
      password: "p".repeat(PASSWORD_MAX + 1),
      workspace: "W".repeat(WORKSPACE_NAME_MAX + 1),
    });
    expect(long).toEqual({
      name: "Use at most 80 characters.",
      password: "Use at most 128 characters.",
      workspace: "Use at most 80 characters.",
    });
    // Surrounding spaces do not count, as the server trims them.
    expect(checkSignUp({ ...valid, name: ` ${"N".repeat(NAME_MAX)} ` }).name).toBeUndefined();
    expect(checkWorkspaceName(` ${"W".repeat(WORKSPACE_NAME_MAX)}  `).ok).toBe(true);
  });

  test("messages follow the locale", async () => {
    await setLocale("pt-BR");
    expect(checkSignIn({ email: "", password: "" }).email).toBe("Preencha este campo.");
    expect(checkSignUp({ ...valid, name: "N".repeat(NAME_MAX + 1) }).name).toBe(
      "Use no máximo 80 caracteres.",
    );
  });
});

describe("page titles", () => {
  test("name the screen, then the app, in the current locale", async () => {
    expect(pageTitle("Sign in")).toBe("Sign in · Brigade");
    expect(pageTitle()).toBe("Brigade");
    await setLocale("pt-BR");
    expect(pageTitle("Entrar")).toBe("Entrar · Brigade");
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

  test("the API's error code comes back, so the limit is told apart from other refusals", async () => {
    expect(
      await createWorkspace("x", answer(403, { error: "workspace_limit" }) as typeof fetch),
    ).toEqual({ ok: false, status: 403, error: "workspace_limit" });
    expect(
      await createWorkspace("x", answer(403, { error: "forbidden_origin" }) as typeof fetch),
    ).toEqual({ ok: false, status: 403, error: "forbidden_origin" });
  });
});

describe("opening a new workspace", () => {
  test("set-active tells the session and organization hooks to fetch again", async () => {
    const calls: string[] = [];
    const client = makeAuthClient(async (input) => {
      calls.push(new URL(input instanceof Request ? input.url : String(input)).pathname);
      return Response.json({ id: "ws_1" });
    });
    const signals = ["$sessionSignal", "$activeOrgSignal", "$activeMemberSignal"] as const;
    const before = signals.map((name) => client.$store.atoms[name]?.get());
    let reloaded = false;
    await openWorkspace("ws_1", client, () => {
      reloaded = true;
    });
    expect(reloaded).toBe(false);
    expect(calls).toEqual(["/api/auth/organization/set-active"]);
    // A plain session refetch toggles none of the organization signals, so a mounted
    // `useActiveOrganization` would keep its stale `null`.
    // Better Auth flips each signal in a short timeout after the response.
    await vi.waitFor(() => {
      signals.forEach((name, index) => {
        expect(client.$store.atoms[name]?.get(), name).not.toBe(before[index]);
      });
    });
  });
});

describe("opening a new workspace when set-active fails", () => {
  test("an error answer or a network failure falls back to a page load", async () => {
    for (const fail of [
      async () => Response.json({ message: "Too many requests" }, { status: 429 }),
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ]) {
      let reloaded = false;
      await openWorkspace("ws_1", makeAuthClient(fail as typeof fetch), () => {
        reloaded = true;
      });
      expect(reloaded).toBe(true);
    }
  });
});

describe("the language emails are written in", () => {
  test("a language switch stores it on the user; a failure is only reported", async () => {
    const requests: { path: string; body: unknown }[] = [];
    const client = makeAuthClient(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      requests.push({ path: new URL(request.url).pathname, body: await request.json() });
      return Response.json({ status: true });
    });
    expect(await saveLocale("pt-BR", client)).toBe(true);
    expect(requests).toEqual([{ path: "/api/auth/update-user", body: { locale: "pt-BR" } }]);
    const down = makeAuthClient((async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    expect(await saveLocale("en", down)).toBe(false);
    const refused = makeAuthClient(async () => Response.json({ code: "x" }, { status: 401 }));
    expect(await saveLocale("en", refused)).toBe(false);
  });

  test("quick switches are stored in the order picked: the last pick wins, one overtaken is skipped", async () => {
    const stored: unknown[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const client = makeAuthClient(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const { locale } = (await request.json()) as { locale: string };
      if (stored.length === 0) await slow;
      stored.push(locale);
      return Response.json({ status: true });
    });
    const first = saveLocale("pt-BR", client);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = saveLocale("en", client);
    const third = saveLocale("pt-BR", client);
    release();
    await Promise.all([first, second, third]);
    // The first was already sent; "en" was overtaken by the third pick before its turn.
    expect(stored).toEqual(["pt-BR", "pt-BR"]);
  });
});
