// @vitest-environment happy-dom
// "Phones and pages" in the settings and "Use the app" on the account page (RFC 0015 section 8): which relay pages go
// through, its state with what to do, and which app to install. Worst cases too: a very long host, pt-BR, no answer,
// an answer without the relay, the first check still on its way.
import { setLocale as setI18nLocale, type Locale } from "@freecorps/brigade-i18n";
import type { Role } from "@freecorps/brigade-schema";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { PhonesPagesCard, PhonesPagesPanel } from "../src/components/phones-pages-card";
import { PreferencesProvider } from "../src/components/preferences";
import { MemberProvider } from "../src/components/session";
import { UseAppCard, UseAppPanel } from "../src/components/use-app-card";
import {
  UNREACHABLE,
  type PagingAnswer,
  type PagingHealth,
  type RelaySetup,
} from "../src/lib/paging-health";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_HOST = `paging-relay-${"very-long-subdomain-".repeat(6)}acme-industries.example`;
const APP = "https://apps.example.com/acme-brigade";

const health = (
  relay: RelaySetup | null,
  status: PagingHealth["status"] = "ok",
  reasons: PagingHealth["reasons"] = [],
): PagingHealth => ({
  status,
  reasons,
  lastOkAt: status === "ok" ? null : new Date("2026-10-31T09:15:00.000Z"),
  relay,
});
const freecorps: RelaySetup = { kind: "freecorps" };
const own = (app: string | null = APP, host: string | null = "relay.acme.example"): RelaySetup => ({
  kind: "own",
  host,
  app,
});

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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

const panel = (value: PagingAnswer | undefined, locale: Locale = "en") =>
  mount(<PhonesPagesPanel health={value} locale={locale} />, locale);

describe("PhonesPagesPanel", () => {
  test("Freecorps' relay, working", async () => {
    const shown = await panel(health(freecorps));
    expect(shown.textContent).toContain("Pages go through Freecorps' relay");
    expect(shown.textContent).toContain("App Store and Google Play");
    expect(shown.textContent).toContain("Working");
    // Freecorps' relay has no app row, and its host is not the point.
    expect(shown.textContent).not.toContain("App to install");
    expect(shown.textContent).not.toContain("relay.example.com");
  });

  test("an own relay names its host and links its app", async () => {
    const shown = await panel(health(own()));
    expect(shown.textContent).toContain("your company's own relay (relay.acme.example)");
    expect(shown.textContent).toContain("can't get its pages");
    const link = shown.querySelector("a");
    expect(link?.getAttribute("href")).toBe(APP);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  test("an own relay without a link says how to add one; without a host, no parentheses", async () => {
    const shown = await panel(health(own(null, null)));
    expect(shown.textContent).toContain("Pages go through your company's own relay");
    expect(shown.textContent).not.toContain("()");
    expect(shown.textContent).toContain("No link to your company's app is set");
    expect(shown.querySelector("code")?.textContent).toBe("vp run setup:relay");
    expect(shown.querySelector("a")).toBeNull();
  });

  test("no relay: phones aren't paged, email still is, and the command to set one up", async () => {
    const shown = await panel(health({ kind: "none" }, "degraded", ["relay_not_configured"]));
    expect(shown.textContent).toContain("No relay: phones aren't paged");
    expect(shown.textContent).toContain("by email when this instance can send email");
    expect(shown.querySelector("code")?.textContent).toBe("vp run setup:relay");
    // No state row: a relay that isn't there has none.
    expect(shown.textContent).not.toContain("State");
  });

  test("no relay, but Brigade's own trouble still shows: beats stopped, the database", async () => {
    const stalled = await panel(
      health({ kind: "none" }, "degraded", ["relay_not_configured", "pipeline_stalled"]),
    );
    expect(stalled.textContent).toContain("No relay: phones aren't paged");
    expect(stalled.textContent).toContain("Held up in Brigade");
    act(() => root?.unmount());
    container.remove();
    const database = await panel(
      health({ kind: "none" }, "degraded", ["relay_not_configured", "d1_failing"]),
    );
    expect(database.textContent).toContain("Database not answering");
    expect(database.textContent).toContain("database (D1)");
  });

  test("each refusal says what to run", async () => {
    const unregistered = await panel(
      health(freecorps, "degraded", ["relay_instance_unregistered"]),
    );
    expect(unregistered.textContent).toContain("Not registered");
    expect(unregistered.textContent).toContain("code emailed to your contact");
    expect(unregistered.querySelector("code")?.textContent).toBe("vp run setup:relay");
    expect(unregistered.textContent).toContain("Last self-check that got through:");
    act(() => root?.unmount());
    container.remove();

    // A bad signature names the secrets to check and warns against setting the relay up again (a new instance id).
    const signature = await panel(health(own(), "degraded", ["relay_bad_signature"]));
    expect(signature.textContent).toContain("Refused");
    expect(signature.textContent).toContain("RELAY_INSTANCE_ID is the instance's first id");
    expect(signature.textContent).toContain("Don't set the relay up again for this");
    expect(signature.querySelector("code")).toBeNull();
    act(() => root?.unmount());
    container.remove();

    // A refused send token on Freecorps' relay: its setup flow never sets one, so no command, the token by hand.
    const token = await panel(health(freecorps, "degraded", ["relay_unauthorized"]));
    expect(token.textContent).toContain(
      "Set the same RELAY_SEND_TOKEN on the relay and on the API.",
    );
    expect(token.querySelector("code")).toBeNull();
    act(() => root?.unmount());
    container.remove();
    // On an own relay the script sets a matching pair on both Workers.
    const ownToken = await panel(health(own(), "degraded", ["relay_unauthorized"]));
    expect(ownToken.textContent).toContain("Run setup again to set a matching token");
    expect(ownToken.querySelector("code")?.textContent).toBe("vp run setup:relay");
    act(() => root?.unmount());
    container.remove();

    const revoked = await panel(health(freecorps, "degraded", ["relay_instance_revoked"]));
    expect(revoked.textContent).toContain("Write to Freecorps");
    expect(revoked.querySelector("code")).toBeNull();
  });

  test("unreachable, rate limited and handles unavailable, own and Freecorps'", async () => {
    const cases: [RelaySetup, PagingHealth["reasons"], string][] = [
      [own(), ["relay_unreachable"], "Your relay isn't answering"],
      [freecorps, ["relay_unreachable"], "Freecorps' relay isn't answering"],
      [freecorps, ["relay_rate_limited"], "Rate limited"],
      [own(), ["relay_handles_unavailable"], "RELAY_HANDLE_KEYS"],
      [
        freecorps,
        ["relay_handles_unavailable"],
        "phones registered with a relay handle aren't paged",
      ],
      [own(), ["apns_failing"], "--replace-credentials"],
      [freecorps, ["pipeline_stalled"], "Held up in Brigade"],
    ];
    for (const [relay, reasons, expected] of cases) {
      const shown = await panel(health(relay, "degraded", reasons));
      expect(shown.textContent, reasons.join()).toContain(expected);
      act(() => root?.unmount());
      container.remove();
    }
  });

  test("before the first check: placeholders, busy, nothing claimed", async () => {
    const shown = await panel(undefined);
    expect(shown.querySelector("dl")?.getAttribute("aria-busy")).toBe("true");
    expect(shown.textContent).not.toContain("Freecorps");
    expect(shown.textContent).not.toContain("Working");
  });

  test("no answer from the API, or one without the relay", async () => {
    const unreachable = await panel(UNREACHABLE);
    expect(unreachable.textContent).toContain("Couldn't tell which relay pages go through.");
    expect(unreachable.textContent).toContain("Couldn't check");
    act(() => root?.unmount());
    container.remove();
    // The watchdog down (a 503 with the relay): the relay and its app are still shown, only the state is unknown.
    const down = await panel({ status: "unreachable", relay: own() });
    expect(down.textContent).toContain("your company's own relay (relay.acme.example)");
    expect(down.textContent).toContain("Couldn't check");
    expect(down.querySelector("a")?.getAttribute("href")).toBe(APP);
    act(() => root?.unmount());
    container.remove();
    // An older API that names no relay: a hint that depends on whose relay it is doesn't guess.
    const revoked = await panel(health(null, "degraded", ["relay_instance_revoked"]));
    expect(revoked.textContent).toContain("Refused");
    expect(revoked.textContent).toContain("Brigade didn't say which relay this is");
    expect(revoked.textContent).not.toContain("Write to Freecorps");
    act(() => root?.unmount());
    container.remove();
    const older = await panel(health(null));
    expect(older.textContent).toContain("Couldn't tell which relay");
    // The state is still known.
    expect(older.textContent).toContain("Working");
  });

  test("degraded without the session's details: Brigade answered, so it says that, not 'didn't answer'", async () => {
    const shown = await panel({ status: "degraded", reasons: [], lastOkAt: null, relay: null });
    expect(shown.textContent).toContain("answered the paging check without saying why");
    expect(shown.textContent).not.toContain("didn't answer");
  });

  test("a very long host is shown whole, never cut, and marked to wrap anywhere", async () => {
    // happy-dom has no layout: that it wraps inside the card at 320px is checked in the worst-case screenshots.
    const shown = await panel(health(own(APP, LONG_HOST)));
    const relay = [...shown.querySelectorAll("p")].find((p) => p.textContent?.includes(LONG_HOST));
    expect(relay?.textContent).toBe(`Pages go through your company's own relay (${LONG_HOST})`);
    expect(relay?.className).toContain("[overflow-wrap:anywhere]");
    expect(relay?.className).not.toMatch(/truncate|line-clamp/);
  });

  test("in pt-BR", async () => {
    const shown = await panel(health(own(), "degraded", ["relay_instance_unregistered"]), "pt-BR");
    expect(shown.textContent).toContain("Celulares e acionamentos");
    expect(shown.textContent).toContain("relay próprio da sua empresa (relay.acme.example)");
    expect(shown.textContent).toContain("Não registrada");
    expect(shown.textContent).toContain("App para instalar");
  });
});

describe("PhonesPagesCard", () => {
  const answer = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;
  const asRole = (role: Role, fetcher: typeof fetch) =>
    mount(
      <MemberProvider workspaceId="ws_1" userId="usr_1" role={role}>
        <PhonesPagesCard fetcher={fetcher} />
      </MemberProvider>,
    );

  test("owners and admins see it, from the paging check", async () => {
    const body = { status: "ok", reasons: [], lastOkAt: null, relay: own() };
    for (const role of ["owner", "admin"] as const) {
      const shown = await asRole(role, answer(body));
      expect(shown.textContent, role).toContain("your company's own relay (relay.acme.example)");
      act(() => root?.unmount());
      container.remove();
    }
  });

  test("nobody else does", async () => {
    let asked = false;
    const fetcher = (async () => {
      asked = true;
      return Response.json({});
    }) as unknown as typeof fetch;
    for (const role of ["responder", "viewer"] as const) {
      const shown = await asRole(role, fetcher);
      expect(shown.textContent, role).toBe("");
      act(() => root?.unmount());
      container.remove();
    }
    expect(asked).toBe(false);
  });
});

describe("UseAppPanel", () => {
  const card = (value: PagingAnswer | undefined, locale: Locale = "en") =>
    mount(<UseAppPanel health={value} />, locale);

  test("Freecorps' relay: the store app, and that pages arrive there", async () => {
    const shown = await card(health(freecorps));
    expect(shown.textContent).toContain(
      "Install the Brigade app from the App Store or Google Play",
    );
    expect(shown.textContent).toContain("allow notifications");
  });

  test("only the advice sentence is live, and it stays the same element when the check lands", async () => {
    const shown = await card(undefined);
    const live = shown.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0]?.tagName).toBe("P");
    const before = live[0];
    await act(async () => {
      root!.render(
        <PreferencesProvider initialLocale="en">
          <UseAppPanel health={health(own())} />
        </PreferencesProvider>,
      );
    });
    const after = shown.querySelector("[aria-live]");
    expect(after).toBe(before);
    expect(after?.textContent).toContain("your company's own build");
    // The heading, description and link are not in the live region.
    expect(after?.querySelector("a")).toBeNull();
    expect(after?.textContent).not.toContain("Use the app");
  });

  test("an own relay: the company's build, with its link", async () => {
    const shown = await card(health(own()));
    expect(shown.textContent).toContain("your company's own build");
    expect(shown.textContent).toContain("can't get them");
    const link = shown.querySelector("a");
    expect(link?.getAttribute("href")).toBe(APP);
    expect(link?.textContent).toBe("Get your company's app");
  });

  test("an own relay without a link: ask an owner or admin", async () => {
    const shown = await card(health(own(null)));
    expect(shown.textContent).toContain("Ask an owner or admin");
    expect(shown.querySelector("a")).toBeNull();
  });

  test("no relay: nothing about pages", async () => {
    const shown = await card(health({ kind: "none" }, "degraded", ["relay_not_configured"]));
    expect(shown.textContent).toContain("follow incidents");
    expect(shown.textContent).not.toMatch(/page|notification/i);
  });

  test("loading, and no answer", async () => {
    expect((await card(undefined)).textContent).toContain("Checking which app");
    act(() => root?.unmount());
    container.remove();
    expect((await card(UNREACHABLE)).textContent).toContain("Couldn't check which app");
    act(() => root?.unmount());
    container.remove();
    // The watchdog down: the 503 still says which relay, so the advice stands.
    const down = await card({ status: "unreachable", relay: own() });
    expect(down.querySelector("a")?.getAttribute("href")).toBe(APP);
  });

  test("in pt-BR", async () => {
    const shown = await card(health(own()), "pt-BR");
    expect(shown.textContent).toContain("Use o app");
    expect(shown.textContent).toContain("Baixar o app da sua empresa");
  });

  test("the card asks the paging check itself", async () => {
    const fetcher = (async () =>
      Response.json({
        status: "ok",
        reasons: [],
        lastOkAt: null,
        relay: own(),
      })) as unknown as typeof fetch;
    const shown = await mount(<UseAppCard fetcher={fetcher} />);
    expect(shown.querySelector("a")?.getAttribute("href")).toBe(APP);
  });
});
