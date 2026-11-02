/**
 * Where the root layout sends the app as the session is read: the real `src/app/_layout.tsx` over every route file
 * in `src/app` (each drawn as its name), with the session faked. Expo Router picks a guard's default destination from
 * the route files rather than the layout's screens, so a route file added later takes part here without being listed.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, jest, test } from "@jest/globals";
import { router, Stack } from "expo-router";
import { act, renderRouter, screen, type RenderRouterResult } from "expo-router/testing-library";
import * as SplashScreen from "expo-splash-screen";
import type { ReactNode } from "react";
import { Text } from "react-native";

type Kind = "loading" | "signed-out" | "ready";

/** What the fake session says; `mock` in its name lets the hoisted `jest.mock` below read it. */
const mockSession = (() => {
  let kind: Kind = "loading";
  const listeners = new Set<() => void>();
  return {
    get: () => kind,
    set: (next: Kind) => {
      kind = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
})();

jest.mock("@/components/session", () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import("react")>("react");
  const useKind = () => useSyncExternalStore(mockSession.subscribe, mockSession.get);
  return {
    // Signed in only once ready; loading, signed out and every other state draw sign-in.
    Session: ({ children }: { children: (ready: boolean) => ReactNode }) =>
      children(useKind() === "ready"),
    useSessionView: () => ({ kind: useKind() }),
  };
});
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hide: jest.fn(),
}));
// Native work the layout starts (CallKit, notification categories, page taps): not routing.
jest.mock("@/hooks/use-incoming-calls", () => ({ useIncomingCalls: () => {} }));
jest.mock("@/hooks/use-page-actions", () => ({ usePageActions: () => {} }));
jest.mock("@/hooks/use-page-taps", () => ({ usePageTaps: () => {} }));

const appDir = join(__dirname, "app");

/** Every route file by its name; the root layout is the real one, the others draw their name. */
function routes() {
  const context: Record<string, unknown> = {};
  for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".tsx")) continue;
    const name = file.replace(/\.tsx$/, "");
    if (name === "_layout") context[name] = require("./app/_layout");
    else if (name.endsWith("_layout")) context[name] = { default: () => <Stack /> };
    else context[name] = { default: () => <Text>{name}</Text> };
  }
  return context;
}

let app: RenderRouterResult | undefined;

/** Opens the app at `initialUrl` (a cold start, or one from a link) with the session saying `kind`. */
async function launch(kind: Kind, initialUrl = "/") {
  mockSession.set(kind);
  app = await renderRouter(routes() as never, { initialUrl });
}

const session = (kind: Kind) => act(async () => mockSession.set(kind));
const go = (navigate: () => void) => act(async () => navigate());

/** The root stack's routes, bottom first. */
function rootStack(): string[] {
  const root = app?.getRouterState()?.routes[0]?.state as { routes: { name: string }[] };
  return root.routes.map((route) => route.name);
}

const link = "/connect?server=https%3A%2F%2Fbrigade.example.org";

beforeEach(() => {
  jest.mocked(SplashScreen.hide).mockClear();
});

test("a signed-in cold start lands on the tabs once the session is read", async () => {
  await launch("loading");
  // Still reading: sign-in draws the loading state, under the launch screen.
  expect(screen).toHavePathname("/sign-in");
  expect(SplashScreen.hide).not.toHaveBeenCalled();
  await session("ready");
  expect(screen).toHavePathname("/");
  expect(rootStack()).toEqual(["(tabs)"]);
  expect(screen.getByText("(tabs)/(incidents)/index")).toBeTruthy();
  expect(SplashScreen.hide).toHaveBeenCalled();
});

test("a signed-out cold start lands on sign-in", async () => {
  await launch("loading");
  await session("signed-out");
  expect(screen).toHavePathname("/sign-in");
  expect(rootStack()).toEqual(["sign-in"]);
  expect(screen.getByText("sign-in")).toBeTruthy();
  expect(SplashScreen.hide).toHaveBeenCalled();
});

test("a session already read opens on its own screen", async () => {
  await launch("ready");
  expect(screen).toHavePathname("/");
  expect(rootStack()).toEqual(["(tabs)"]);
});

test("a session read that hangs still lets the launch screen go", async () => {
  await launch("loading");
  expect(SplashScreen.hide).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(3000));
  expect(SplashScreen.hide).toHaveBeenCalled();
  expect(screen).toHavePathname("/sign-in");
});

test("a dashboard link on a cold start lands on connect, and leaves it for the tabs", async () => {
  await launch("loading", link);
  expect(screen).toHavePathname("/connect");
  await session("ready");
  expect(screen).toHavePathname("/connect");
  expect(screen).toHaveSearchParams({ server: "https://brigade.example.org" });
  expect(rootStack()).toEqual(["connect"]);
  // Leaving the sheet with nothing under it (screens/add-instance.tsx, leaveSheet) goes to "/".
  await go(() => router.replace("/"));
  expect(screen).toHavePathname("/");
  expect(rootStack()).toEqual(["(tabs)"]);
});

test("a dashboard link on a signed-out cold start lands on connect, and leaves it for sign-in", async () => {
  await launch("loading", link);
  await session("signed-out");
  expect(screen).toHavePathname("/connect");
  await go(() => router.replace("/"));
  expect(screen).toHavePathname("/sign-in");
});

test("a dashboard link opened while signed in lands on connect over the tabs", async () => {
  await launch("ready");
  await go(() => router.navigate(link));
  expect(screen).toHavePathname("/connect");
  expect(rootStack()).toEqual(["(tabs)", "connect"]);
  await go(() => router.back());
  expect(screen).toHavePathname("/");
});

test("a session that ends while open goes to sign-in", async () => {
  await launch("ready");
  await go(() => router.push("/legend"));
  expect(screen).toHavePathname("/legend");
  await session("signed-out");
  expect(screen).toHavePathname("/sign-in");
  // Read again (an instance switched to): loading draws sign-in too, then the tabs.
  await session("loading");
  expect(screen).toHavePathname("/sign-in");
  await session("ready");
  expect(screen).toHavePathname("/");
});

test("the instance screens open from sign-in", async () => {
  await launch("signed-out");
  await go(() => router.push("/add-instance"));
  await go(() => router.push("/scan"));
  expect(screen).toHavePathname("/scan");
  expect(rootStack()).toEqual(["sign-in", "add-instance", "scan"]);
  await go(() => router.dismissAll());
  expect(screen).toHavePathname("/sign-in");
  // Signed in on the instance the scanner added: the tabs.
  await go(() => router.push({ pathname: "/instance/[id]", params: { id: "abc" } }));
  expect(screen).toHavePathname("/instance/abc");
  await go(() => router.dismissAll());
  await session("ready");
  expect(screen).toHavePathname("/");
});

test("the instance screens open from the account section", async () => {
  await launch("ready");
  await go(() => router.push({ pathname: "/instance/[id]", params: { id: "abc" } }));
  expect(screen).toHavePathname("/instance/abc");
  expect(rootStack()).toEqual(["(tabs)", "instance/[id]"]);
  await go(() => router.back());
  await go(() => router.push("/add-instance"));
  await go(() => router.push("/scan"));
  expect(rootStack()).toEqual(["(tabs)", "add-instance", "scan"]);
  await go(() => router.dismissAll());
  expect(screen).toHavePathname("/");
});
