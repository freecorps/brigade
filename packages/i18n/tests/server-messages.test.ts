// The server entry requires `{ locale }` on every message. The `@ts-expect-error` lines are the test:
// `vp check` type-checks this file and fails if any of them stops being an error.
import { expect, test } from "vite-plus/test";
import { m as uiMessages } from "../src/index.ts";
import {
  incidentStatusLabels,
  serverIncidentStatusLabels,
  serverSeverityLabels,
  severityLabels,
} from "../src/labels.ts";
import type * as server from "../src/messages.ts";
import { app_name, incidents_active_count, m, theme_dark } from "../src/messages.ts";

test("a message from the server entry needs a locale to type-check", () => {
  // @ts-expect-error no options: the message would render in whatever locale the isolate holds.
  expect(() => theme_dark()).not.toThrow();
  // @ts-expect-error options without a locale.
  expect(() => theme_dark({}, {})).not.toThrow();
  // @ts-expect-error inputs but no options.
  expect(() => incidents_active_count({ count: 2 })).not.toThrow();
  // @ts-expect-error the same through `m`.
  expect(() => m.theme_dark({})).not.toThrow();
  // @ts-expect-error not a locale.
  expect(() => app_name({}, { locale: "pt" })).not.toThrow();

  expect(theme_dark({}, { locale: "pt-BR" })).toBe("Escuro");
  expect(m.theme_dark({}, { locale: "en" })).toBe("Dark");
  expect(incidents_active_count({ count: 2 }, { locale: "pt-BR" })).toBe("2 incidentes ativos");
});

test("the server entry is Paraglide's messages at runtime, only retyped", () => {
  expect(theme_dark).toBe(uiMessages.theme_dark);
  expect(Object.keys(m).sort()).toEqual(Object.keys(uiMessages).sort());
});

// The names of the server entry's functions that still accept a call without options. A message missing
// from src/messages.ts's declarations would come through `export *` with Paraglide's optional options.
type Loose = {
  [K in keyof typeof server]: (typeof server)[K] extends (...args: infer A) => unknown
    ? undefined extends A[1]
      ? K
      : never
    : never;
}[keyof typeof server];

test("every named message requires a locale", () => {
  const loose: [Loose] extends [never] ? "none" : Loose = "none";
  expect(loose).toBe("none");
  expect(Object.keys(m).length).toBeGreaterThan(400);
});

test("the server labels need a locale too, and are the UI labels at runtime", () => {
  // @ts-expect-error no options.
  expect(() => serverSeverityLabels.sev1()).not.toThrow();
  // @ts-expect-error options without a locale.
  expect(() => serverIncidentStatusLabels.triage({}, {})).not.toThrow();

  expect(serverIncidentStatusLabels.investigating({}, { locale: "pt-BR" })).toBe(
    incidentStatusLabels.investigating({}, { locale: "pt-BR" }),
  );
  expect(serverSeverityLabels).toBe(severityLabels);
});
