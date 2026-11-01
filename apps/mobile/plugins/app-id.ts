// The app's identifiers (RFC 0015 section 8, docs/open-questions.md Q32). The bundle id and Android package are the
// build variable `BRIGADE_APP_ID`, so a company builds its own app without editing this copy; the App Group the app
// shares with its extensions is derived from it.

/** The store app's id: one id on both stores, under the Freecorps Apple team. */
export const DEFAULT_APP_ID = "app.freecorps.brigade";

/**
 * The Info.plist key each target (app, Notification Service Extension, widget) reads its App Group from at runtime,
 * so the Swift code holds no group of its own.
 */
export const APP_GROUP_PLIST_KEY = "BrigadeAppGroup";

/**
 * An id both stores accept as bundle id and package: two or more parts, each a letter then letters or digits (Apple
 * refuses `_`, Android `-` and a part that starts with a digit). The same rule is `BUNDLE_ID` in apps/relay
 * `scripts/setup-relay/flow.ts` (the relay's topic) and `APP_ID_PATTERN` in scripts/lib/mobile.mjs; a test in
 * notification-service.test.ts keeps the three the same.
 */
export const APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;

/** `BRIGADE_APP_ID`, or the store app's id when unset or empty. Throws for an id either store would refuse. */
export function appId(env: Record<string, string | undefined> = process.env): string {
  const value = env.BRIGADE_APP_ID?.trim();
  if (!value) return DEFAULT_APP_ID;
  if (!APP_ID_PATTERN.test(value)) {
    throw new Error(
      `BRIGADE_APP_ID ${JSON.stringify(value)} is not a bundle id and Android package (com.acme.brigade).`,
    );
  }
  return value;
}

/** The App Group of the app whose bundle id this is: `group.<bundle id>`. */
export function appGroup(bundleIdentifier: string): string {
  return `group.${bundleIdentifier}`;
}
