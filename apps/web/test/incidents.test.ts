import { setLocale } from "@freecorps/brigade-i18n";
import type { SyncErrorCode } from "@freecorps/brigade-sync";
import { afterEach, expect, test } from "vite-plus/test";
import {
  adjustBusy,
  checkDeclare,
  formatAge,
  mutationErrorReason,
  nextStatuses,
  noticeFor,
  noticeSubject,
  noticeText,
  queryErrorReason,
  titleRefused,
  type NoticeTarget,
} from "../src/lib/incidents";
import { CLIENT_ID_STORAGE_KEY, syncUrl, tabClientId } from "../src/lib/sync";
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

// syncView and nextFailed are tested in packages/sync (tests/view.test.ts).
test("a refused list says why", () => {
  expect(queryErrorReason("forbidden")).toBe("You don't have access to these incidents.");
  expect(queryErrorReason("internal")).toBe(queryErrorReason(undefined));
  // The page's own client having stopped is not a server error.
  expect(queryErrorReason("closed")).toBe("This page stopped syncing. Reload it to try again.");
});

test("ages read 'just now' under a minute, then the shared relative format", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);
  expect(formatAge(now - 59_000, now, "en")).toBe("just now");
  expect(formatAge(now - 3 * 60_000, now, "en")).toBe("3 minutes ago");
  expect(formatAge(now - 59_000, now, "pt-BR")).toBe("agora");
  expect(formatAge(now - 2 * 3_600_000, now, "pt-BR")).toBe("há 2 horas");
});

const change: NoticeTarget = {
  kind: "status",
  incidentId: ID,
  number: 12,
  title: "Checkout down",
  to: "fixing",
};
const fail = (code: SyncErrorCode, issues?: { path: string; message: string }[]) => ({
  ok: false as const,
  error: { code, message: "English", ...(issues ? { issues } : {}) },
});

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
    expect(notice).toEqual({ ...change, key: "k", reason: code });
    const reason = mutationErrorReason(code);
    // In the card the text names the incident and the change; in its row it does not need to.
    expect(noticeText(notice, "card")).toBe(
      `Couldn't move INC-12 “Checkout down” to Fixing. ${reason}`,
    );
    expect(noticeText(notice, "row")).toBe(`Couldn't move it to Fixing. ${reason}`);
    expect(noticeText(notice, "card")).not.toContain("English");
  }
  expect(mutationErrorReason("expired")).toMatch(/waited too long/);
  expect(mutationErrorReason("too_many_pending")).toMatch(/Wait for the pending changes/);
  expect(mutationErrorReason("closed")).toMatch(/stopped syncing/);
  expect(mutationErrorReason("unknown_mutation")).toBe(mutationErrorReason("internal"));

  const severity = noticeFor(fail("conflict"), { ...change, kind: "severity", to: "sev1" }, "k")!;
  // The full severity label, as the badges show it.
  expect(noticeText(severity, "card")).toMatch(
    /^Couldn't change INC-12 “Checkout down” to SEV1 Critical\./,
  );
  // Not numbered yet: the title alone names it. The card draws the subject as separate parts.
  const unnumbered = noticeFor(fail("not_found"), { ...change, number: null }, "k")!;
  expect(noticeText(unnumbered, "card")).toBe(
    "Couldn't move “Checkout down” to Fixing. The incident no longer exists.",
  );
  expect(noticeSubject(severity)).toEqual({ number: "INC-12", title: "“Checkout down”" });
  expect(noticeSubject(unnumbered)).toEqual({ number: null, title: "“Checkout down”" });
  // Worded at render, so a locale switch shows.
  const declared = noticeFor(fail("forbidden"), { ...change, kind: "declare", number: null }, "k")!;
  expect(noticeText(declared, "row")).toBe(
    "Couldn't declare it. You don't have permission to do that.",
  );
  await setLocale("pt-BR");
  expect(noticeText(declared, "card")).toBe(
    "Não foi possível declarar “Checkout down”. Você não tem permissão para fazer isso.",
  );
  expect(mutationErrorReason("conflict")).toBe("Alguém alterou isso antes de você.");
});

test("an invalid_args naming the id is the device clock, not the title", () => {
  const declare: NoticeTarget = { kind: "declare", incidentId: ID, number: null, title: "Up" };
  const skew = noticeFor(fail("invalid_args", [{ path: "id", message: "ahead" }]), declare, "k")!;
  expect(skew.reason).toBe("clock_skew");
  expect(noticeText(skew, "card")).toBe(
    "Couldn't declare “Up”. Your device clock is ahead of the server. Fix the date and time and try again.",
  );
  expect(titleRefused(skew)).toBe(false);
  const title = noticeFor(fail("invalid_args", [{ path: "title", message: "x" }]), declare, "k");
  expect(title?.reason).toBe("invalid_args");
  expect(titleRefused(title)).toBe(true);
  expect(titleRefused(noticeFor(fail("invalid_args"), change, "k"))).toBe(false); // Not a declare.
});

test("busy counts in-flight changes per key and forgets a key at zero", () => {
  let busy: ReadonlyMap<string, number> = new Map();
  busy = adjustBusy(busy, ["a", "a/status"], 1);
  busy = adjustBusy(busy, ["a", "a/severity"], 1);
  busy = adjustBusy(busy, ["b"], 1);
  expect(Object.fromEntries(busy)).toEqual({ a: 2, "a/status": 1, "a/severity": 1, b: 1 });
  busy = adjustBusy(busy, ["a", "a/status"], -1);
  busy = adjustBusy(busy, ["b"], -1);
  expect(Object.fromEntries(busy)).toEqual({ a: 1, "a/severity": 1 });
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
