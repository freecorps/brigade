import { setLocale } from "@freecorps/brigade-i18n";
import type { SyncErrorCode } from "@freecorps/brigade-sync";
import { afterEach, expect, test } from "vite-plus/test";
import { DEV_ACTOR as API_DEV_ACTOR } from "../../api/src/dev-actor.ts";
import {
  adjustBusy,
  checkDeclare,
  mutationErrorReason,
  nextFailed,
  nextStatuses,
  noticeFor,
  noticeText,
  queryErrorReason,
  syncView,
  type NoticeTarget,
} from "../src/lib/incidents";
import { CLIENT_ID_STORAGE_KEY, DEV_ACTOR, syncUrl, tabClientId } from "../src/lib/sync";
import { memoryStorage, throwingStorage } from "./storage";

afterEach(() => setLocale("en"));

const ID = "inc_01M5PWGDG00000000000000001";

test("only the moves the lifecycle allows are offered, never the current status", () => {
  expect(nextStatuses("triage")).toEqual([
    "investigating",
    "fixing",
    "monitoring",
    "resolved",
    "declined",
  ]);
  expect(nextStatuses("fixing")).not.toContain("fixing");
  expect(nextStatuses("resolved")).toEqual(["investigating"]);
  expect(nextStatuses("declined")).toEqual([]);
});

test("a failed connect latches until data arrives, so retries do not flicker", () => {
  let failed = false;
  const step = (status: "loading" | "ready", connection: "connecting" | "open" | "waiting") =>
    (failed = nextFailed(failed, status, connection));
  expect(step("loading", "connecting")).toBe(false);
  expect(syncView("loading", "connecting", failed)).toBe("connecting");
  expect(step("loading", "waiting")).toBe(true);
  expect(step("loading", "connecting")).toBe(true); // The next attempt.
  expect(syncView("loading", "connecting", failed)).toBe("unavailable");
  expect(step("ready", "open")).toBe(false);
  expect(syncView("ready", "open", failed)).toBe("live");
});

test("after the list loaded, a dropped socket is reconnecting; a refused list is its own state", () => {
  expect(syncView("ready", "waiting", false)).toBe("reconnecting");
  expect(syncView("ready", "connecting", false)).toBe("reconnecting");
  // The shard said no: nothing retries it, so this is not "unavailable, still trying".
  expect(syncView("error", "open", false)).toBe("refused");
  expect(syncView("error", "waiting", true)).toBe("refused");
  expect(queryErrorReason("forbidden")).toBe("You don't have access to these incidents.");
  expect(queryErrorReason("internal")).toBe(queryErrorReason(undefined));
});

const change: NoticeTarget = { kind: "change", incidentId: ID, number: 12, title: "Checkout down" };
const fail = (code: SyncErrorCode) => ({ ok: false as const, error: { code, message: "English" } });

test("every refused outcome becomes a notice with a translated reason; a confirmed one none", async () => {
  expect(noticeFor({ ok: true, version: 3 }, change, "k")).toBeUndefined();
  const codes: SyncErrorCode[] = [
    "forbidden",
    "not_found",
    "conflict",
    "invalid_transition",
    "invalid_args",
    "internal",
    "unknown_mutation",
    "expired",
    "too_many_pending",
    "closed",
  ];
  for (const code of codes) {
    const notice = noticeFor(fail(code), change, "k")!;
    expect(notice).toEqual({ ...change, key: "k", code });
    const text = noticeText(notice);
    expect(text).toBe(`Couldn't update INC-12. ${mutationErrorReason(code)}`);
    expect(text).not.toContain("English");
  }
  expect(mutationErrorReason("expired")).toMatch(/waited too long/);
  expect(mutationErrorReason("too_many_pending")).toMatch(/Too many changes/);
  expect(mutationErrorReason("closed")).toMatch(/stopped syncing/);
  expect(mutationErrorReason("unknown_mutation")).toBe(mutationErrorReason("internal"));

  // Not numbered yet: the title stands in; a declare names its title. Worded at render, so a locale switch shows.
  const unnumbered = noticeFor(fail("not_found"), { ...change, number: null }, "k")!;
  expect(noticeText(unnumbered)).toBe(
    "Couldn't update “Checkout down”. The incident no longer exists.",
  );
  const declared = noticeFor(fail("forbidden"), { ...change, kind: "declare", number: null }, "k")!;
  await setLocale("pt-BR");
  expect(noticeText(declared)).toBe(
    "Não foi possível declarar “Checkout down”. Você não tem permissão para fazer isso.",
  );
  expect(mutationErrorReason("conflict")).toBe("Alguém alterou isso antes de você.");
});

test("busy counts in-flight changes per incident and forgets an incident at zero", () => {
  let busy: ReadonlyMap<string, number> = new Map();
  busy = adjustBusy(busy, "a", 1);
  busy = adjustBusy(busy, "a", 1);
  busy = adjustBusy(busy, "b", 1);
  expect([...busy]).toEqual([
    ["a", 2],
    ["b", 1],
  ]);
  busy = adjustBusy(busy, "a", -1);
  busy = adjustBusy(busy, "b", -1);
  expect([...busy]).toEqual([["a", 1]]);
  expect(busy.has("b")).toBe(false);
});

test("a declare is checked with the mutation's own validator before it is sent", () => {
  expect(checkDeclare(ID, "  Checkout down  ", "sev1")).toEqual({
    ok: true,
    args: { id: ID, title: "Checkout down", severity: "sev1" },
  });
  // Blank, invisible-only or bidi-only titles never reach the shard.
  for (const title of ["", "   ", "​​", "‮‭"]) {
    expect(checkDeclare(ID, title, "sev3")).toEqual({ ok: false });
  }
});

test("the dashboard's optimistic actor is the one the API's dev sockets act as", () => {
  expect(DEV_ACTOR).toEqual(API_DEV_ACTOR);
});

test("the socket URL follows the page's origin and scheme", () => {
  expect(syncUrl({ protocol: "http:", host: "localhost:5173" }, "demo")).toBe(
    "ws://localhost:5173/api/sync/demo",
  );
  expect(syncUrl({ protocol: "https:", host: "brigade.example" }, "demo")).toBe(
    "wss://brigade.example/api/sync/demo",
  );
});

test("the client id is kept per tab and replaced when invalid or unreadable", () => {
  const storage = memoryStorage();
  let made = 0;
  const create = () => `cli_${++made}`;
  expect(tabClientId(storage, create)).toBe("cli_1");
  expect(tabClientId(storage, create)).toBe("cli_1");
  storage.setItem(CLIENT_ID_STORAGE_KEY, "not valid!");
  expect(tabClientId(storage, create)).toBe("cli_2");
  expect(tabClientId(throwingStorage, create)).toBe("cli_3");
  expect(tabClientId(undefined, create)).toBe("cli_4");
});
