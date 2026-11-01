// @vitest-environment happy-dom
// "Use the app"'s QR sign-in (RFC 0015 section 6): no code until asked, the QR with its countdown and warning, the
// claim naming the device with the number to type (never shown here), approve, deny, a wrong number, expiry, a
// failure; and the address-only QR. The claiming phone is named only by its kind, never its own words (they could
// carry the number). Worst cases too: pt-BR, full-width digits, a cancel that fails.
import { setLocale as setI18nLocale, type Locale } from "@freecorps/brigade-i18n";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { AddressQrCard, AppSignInCard } from "../src/components/app-sign-in-card";
import { PreferencesProvider } from "../src/components/preferences";
import { modules } from "../src/components/qr-code";
import { connectUrl, countdown, typedNumber, type SignInStatus } from "../src/lib/app-sign-in";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "asi_01JBRIGADEQRSIGNINTEST0000";
const URL_IN_QR =
  "brigade://connect?server=https%3A%2F%2Fbrigade.example.com&code=abcdefghijklmnopqrstuv";

let root: Root | undefined;
let container: HTMLElement;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

async function mount(node: ReactNode, locale: Locale = "en") {
  void setI18nLocale(locale);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<PreferencesProvider initialLocale={locale}>{node}</PreferencesProvider>);
  });
  return container;
}

/** A made-up API: what `GET /app-sign-in/:id` answers is `server`, changed by the test as a phone would. */
function fakeApi(
  options: {
    create?: number;
    deny?: number;
    /** Set to answer the status poll with this HTTP status instead. */
    read?: { status: number };
    answer?: (number: string) => SignInStatus;
  } = {},
) {
  const server = {
    status: "waiting" as SignInStatus,
    deviceKind: undefined as string | undefined,
    expiresAt: Date.now() + 120_000,
  };
  const requests: { url: string; method: string; body?: string }[] = [];
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    requests.push({ url: input, method, body: init.body as string | undefined });
    if (input === "/api/app-sign-in" && method === "POST") {
      if (options.create && options.create !== 201)
        return Response.json({}, { status: options.create });
      return Response.json(
        {
          id: ID,
          code: "abcdefghijklmnopqrstuv",
          url: URL_IN_QR,
          expiresAt: new Date(server.expiresAt).toISOString(),
        },
        { status: 201 },
      );
    }
    if (input === `/api/app-sign-in/${ID}` && method === "GET") {
      if (options.read) {
        return Response.json({ error: "unauthenticated" }, { status: options.read.status });
      }
      return Response.json({
        id: ID,
        status: server.status,
        expiresAt: new Date(server.expiresAt).toISOString(),
        ...(server.deviceKind
          ? // A phone-written name the API never sends: should one ever come, it is not shown.
            { deviceKind: server.deviceKind, deviceName: "Type 37 to finish" }
          : {}),
      });
    }
    if (input === `/api/app-sign-in/${ID}/approve`) {
      const { number } = JSON.parse(init.body as string) as { number: string };
      const result = options.answer?.(number) ?? "approved";
      server.status = result;
      return result === "wrong_number"
        ? Response.json({ error: "wrong_number" }, { status: 403 })
        : Response.json({ status: result });
    }
    if (input === `/api/app-sign-in/${ID}/deny`) {
      if (options.deny) return Response.json({ error: "unavailable" }, { status: options.deny });
      server.status = "denied";
      return Response.json({ status: "denied" });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }) as unknown as typeof fetch;
  return { server, requests, fetcher };
}

const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(text));

/** Lets a few polls run (the card polls every 5 ms here). */
const polls = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const submit = async () => {
  await act(async () => {
    container.querySelector("form")!.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

/** Up to the claim: asked, scanned, claimed by a device of `kind`. */
async function claimedBy(kind: string, api = fakeApi(), locale: Locale = "en") {
  await mount(<AppSignInCard fetcher={api.fetcher} pollMs={5} onSignedOut={() => {}} />, locale);
  await click(container.querySelector("button"));
  api.server.status = "claimed";
  api.server.deviceKind = kind;
  await polls();
  return api;
}

describe("AppSignInCard", () => {
  test("no code is made until the member asks for one", async () => {
    const api = fakeApi();
    await mount(<AppSignInCard fetcher={api.fetcher} pollMs={5} />);
    expect(container.querySelector("svg[role=img]")).toBeNull();
    expect(api.requests).toEqual([]);
    expect(button("Show a sign-in code")).toBeTruthy();
  });

  test("the QR, its countdown and the warning while it waits", async () => {
    const api = fakeApi();
    await mount(<AppSignInCard fetcher={api.fetcher} pollMs={5} />);
    await click(button("Show a sign-in code"));
    const qr = container.querySelector("svg[role=img]");
    expect(qr?.getAttribute("aria-label")).toBe("QR code that signs the Brigade app in as you");
    // The code is never in the page's text or label.
    expect(container.textContent).not.toContain("abcdefghijklmnopqrstuv");
    expect(container.textContent).toMatch(/Expires in [12]:[0-5][0-9]/);
    expect(container.textContent).toContain(
      "Never share this code, nor the number your phone shows.",
    );
    expect(container.textContent).toContain("Scan a QR code");
    await polls();
    expect(api.requests.filter((request) => request.method === "GET").length).toBeGreaterThan(0);
  });

  test("a claim names the kind of device and asks for the number, which the dashboard never has", async () => {
    const api = await claimedBy("apple");
    expect(container.textContent).toContain("An iPhone or iPad wants to sign in as you");
    expect(container.textContent).not.toContain("37");
    expect(container.textContent).toContain("Type the number your phone shows");
    expect(container.querySelector("svg[role=img]")).toBeNull();
    const input = container.querySelector("input")!;
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(document.activeElement).toBe(input);
    // Only what the member types travels, and nothing came from the server with a number.
    type(input, "4 2");
    expect(input.value).toBe("42");
    await submit();
    const approve = api.requests.find((request) => request.url.endsWith("/approve"));
    expect(JSON.parse(approve!.body!)).toEqual({ number: "42" });
    expect(container.textContent).toContain("Approved. Finishing on your phone");
    api.server.status = "signed_in";
    await polls();
    expect(container.textContent).toContain("An iPhone or iPad is signed in as you.");
    expect(container.textContent).not.toContain("Type 37");
    expect(button("Sign in another phone")).toBeTruthy();
  });

  test("a malformed number is refused here, without a request", async () => {
    const api = await claimedBy("android");
    expect(container.textContent).toContain("An Android phone wants to sign in as you");
    type(container.querySelector("input")!, "4");
    await submit();
    expect(container.textContent).toContain("Type the 2 digits your phone shows.");
    expect(api.requests.some((request) => request.url.endsWith("/approve"))).toBe(false);
  });

  test("a wrong number ends it", async () => {
    const api = fakeApi({ answer: () => "wrong_number" });
    await claimedBy("android", api);
    type(container.querySelector("input")!, "13");
    await submit();
    expect(container.textContent).toContain("That number didn't match, so nobody was signed in.");
    expect(button("Show a new code")).toBeTruthy();
    expect(container.querySelector("input")).toBeNull();
  });

  test("deny", async () => {
    const api = await claimedBy("phone");
    expect(container.textContent).toContain("A phone wants to sign in as you");
    await click(button("Deny"));
    expect(api.requests.some((request) => request.url.endsWith("/deny"))).toBe(true);
    expect(container.textContent).toContain("Denied. Nobody was signed in.");
  });

  test("cancel drops the code and goes back to the start", async () => {
    const api = fakeApi();
    await mount(<AppSignInCard fetcher={api.fetcher} pollMs={5} />);
    await click(button("Show a sign-in code"));
    await click(button("Cancel"));
    expect(api.requests.some((request) => request.url.endsWith("/deny"))).toBe(true);
    expect(container.querySelector("svg[role=img]")).toBeNull();
    expect(button("Show a sign-in code")).toBeTruthy();
  });

  test("a cancel that fails says so and keeps the code on screen", async () => {
    const api = fakeApi({ deny: 503 });
    await mount(<AppSignInCard fetcher={api.fetcher} pollMs={5} />);
    await click(button("Show a sign-in code"));
    await click(button("Cancel"));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Couldn't cancel.");
    expect(container.querySelector("svg[role=img]")).not.toBeNull();
    expect(button("Show a sign-in code")).toBeUndefined();
  });

  test("a claim that runs out says the sign-in timed out, not the code", async () => {
    const api = await claimedBy("apple");
    api.server.expiresAt = Date.now() - 1000;
    api.server.status = "expired";
    await polls();
    expect(container.textContent).toContain("The sign-in ran out of time before it finished.");
    expect(container.textContent).not.toContain("This code expired");
  });

  test("a poll from before the approval does not take the approval back", async () => {
    const api = await claimedBy("apple");
    type(container.querySelector("input")!, "42");
    await submit();
    expect(container.textContent).toContain("Approved. Finishing on your phone");
    // A stale answer still saying `claimed`.
    api.server.status = "claimed";
    await polls();
    expect(container.textContent).toContain("Approved. Finishing on your phone");
    expect(container.querySelector("input")).toBeNull();
    // It still moves on to how it ended.
    api.server.status = "signed_in";
    await polls();
    expect(container.textContent).toContain("An iPhone or iPad is signed in as you.");
  });

  test("once approved, the claim's old end on this clock does not show it as expired", async () => {
    const api = await claimedBy("apple");
    type(container.querySelector("input")!, "42");
    await submit();
    // The server gave the phone more time; this view's `expiresAt` is the claim's, now past.
    api.server.expiresAt = Date.now() - 1000;
    await polls();
    expect(container.textContent).toContain("Approved. Finishing on your phone");
    expect(container.textContent).not.toContain("ran out of time");
  });

  test("a dashboard session that ended while asking for a code says so and refreshes the session", async () => {
    let refreshed = 0;
    await mount(
      <AppSignInCard
        fetcher={fakeApi({ create: 401 }).fetcher}
        pollMs={5}
        onSignedOut={() => refreshed++}
      />,
    );
    await click(button("Show a sign-in code"));
    expect(container.textContent).toContain("Your dashboard session ended. Sign in again.");
    expect(refreshed).toBe(1);
  });

  test("a dashboard session that ended while waiting stops the polls, says so and refreshes the session", async () => {
    let refreshed = 0;
    const api = fakeApi({ read: { status: 401 } });
    await mount(
      <AppSignInCard fetcher={api.fetcher} pollMs={5} onSignedOut={() => refreshed++} />,
      "pt-BR",
    );
    await click(button("Mostrar um código de acesso"));
    await polls();
    expect(container.textContent).toContain("Sua sessão no painel terminou. Entre de novo.");
    expect(container.querySelector("svg[role=img]")).toBeNull();
    expect(refreshed).toBe(1);
    const polled = api.requests.filter((request) => request.method === "GET").length;
    await polls();
    expect(api.requests.filter((request) => request.method === "GET").length).toBe(polled);
  });

  test("past its time it shows as expired, with a new code to make", async () => {
    const api = fakeApi();
    api.server.expiresAt = Date.now() - 1000;
    await mount(<AppSignInCard fetcher={api.fetcher} pollMs={5} />);
    await click(button("Show a sign-in code"));
    expect(container.textContent).toContain("This code expired before a phone used it.");
    expect(container.querySelector("svg[role=img]")).toBeNull();
    await click(button("Show a new code"));
    expect(api.requests.filter((request) => request.url === "/api/app-sign-in")).toHaveLength(2);
  });

  test("too many codes, and a failure", async () => {
    await mount(<AppSignInCard fetcher={fakeApi({ create: 429 }).fetcher} pollMs={5} />);
    await click(button("Show a sign-in code"));
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Too many codes in a minute",
    );
    act(() => root?.unmount());
    container.remove();
    await mount(<AppSignInCard fetcher={fakeApi({ create: 503 }).fetcher} pollMs={5} />);
    await click(button("Show a sign-in code"));
    expect(container.textContent).toContain("Couldn't make a code.");
  });

  test("in pt-BR, and a kind this dashboard does not know reads as a phone", async () => {
    await claimedBy("tablet-from-a-newer-api", fakeApi(), "pt-BR");
    expect(container.textContent).toContain("Um celular quer entrar como você");
    expect(container.textContent).toContain("Nunca compartilhe este código");
    expect(button("Recusar")).toBeTruthy();
    // It wraps instead of pushing the card wider.
    expect(container.querySelector("form p")?.className).toContain("[overflow-wrap:anywhere]");
  });
});

describe("AddressQrCard", () => {
  test("a QR with the address alone, and the address written out", async () => {
    await mount(<AddressQrCard origin="https://brigade.example.com" />);
    expect(container.textContent).toContain("Only the address");
    expect(container.textContent).toContain("https://brigade.example.com");
    expect(container.querySelector("svg[role=img]")?.getAttribute("aria-label")).toBe(
      "QR code with this Brigade's address",
    );
  });
});

describe("helpers", () => {
  test("the address-only URL", () => {
    expect(connectUrl("https://brigade.example.com")).toBe(
      "brigade://connect?server=https%3A%2F%2Fbrigade.example.com",
    );
  });

  test("the countdown", () => {
    expect(countdown(120_000)).toBe("2:00");
    expect(countdown(61_001)).toBe("1:02");
    expect(countdown(9_000)).toBe("0:09");
    expect(countdown(-5)).toBe("0:00");
  });

  test("the typed number keeps two digits, from any keyboard", () => {
    expect(typedNumber("4 2")).toBe("42");
    expect(typedNumber("４２")).toBe("42");
    expect(typedNumber("123")).toBe("12");
    expect(typedNumber("ab")).toBe("");
  });

  test("the QR has a quiet zone and grows with its content", () => {
    const short = modules(connectUrl("https://a.example"));
    const long = modules(URL_IN_QR);
    // Version 1 is 21 modules, plus 4 on each side.
    expect(short.size).toBeGreaterThanOrEqual(29);
    expect(long.size).toBeGreaterThan(short.size);
    expect(long.path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    // The quiet zone: no module drawn in the first 4 rows or columns.
    expect(long.path).not.toMatch(/M[0-3] |M\d+ [0-3]h/);
  });
});
