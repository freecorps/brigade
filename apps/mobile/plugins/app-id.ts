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

/** Reverse DNS that is also a valid Android package: two or more parts, each a letter then letters, digits or `_`. */
const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** `BRIGADE_APP_ID`, or the store app's id when unset or empty. Throws for an id iOS or Android would refuse. */
export function appId(env: Record<string, string | undefined> = process.env): string {
  const value = env.BRIGADE_APP_ID?.trim();
  if (!value) return DEFAULT_APP_ID;
  if (!APP_ID.test(value)) {
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
