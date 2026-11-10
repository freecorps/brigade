// What a call answered on a locked iPhone needs to read (RFC 0010 "Acknowledging"): the list of instances and each
// instance's session. expo-secure-store keeps items readable only while the phone is unlocked unless told otherwise,
// so a page that woke the app on the lock screen could not read who to acknowledge as, and pressing 1 did nothing.
// These items are kept readable after the phone's first unlock since it started (the Keychain's
// `AfterFirstUnlock`), as an app that works in the background keeps its session; they stay encrypted on the device,
// for this app only. Android's keystore needs nothing: its key does not depend on the screen lock.
//
// Pure apart from the store it is given, so it is tested in Node.

/** The parts of expo-secure-store used here. */
export type KeyStore = {
  getItem(key: string, options?: object): string | null;
  getItemAsync(key: string, options?: object): Promise<string | null>;
  setItem(key: string, value: string, options?: object): void;
  setItemAsync(key: string, value: string, options?: object): Promise<void>;
};

/** `store`, writing every item readable after the first unlock (`accessible`: expo-secure-store's constant). */
export function lockedReadable<S extends KeyStore>(store: S, accessible: number): S {
  const options = (given?: object) => ({ keychainAccessible: accessible, ...given });
  return {
    ...store,
    getItem: (key: string, given?: object) => store.getItem(key, given),
    getItemAsync: (key: string, given?: object) => store.getItemAsync(key, given),
    setItem: (key: string, value: string, given?: object) =>
      store.setItem(key, value, options(given)),
    setItemAsync: (key: string, value: string, given?: object) =>
      store.setItemAsync(key, value, options(given)),
  };
}

/** How many chunks `@better-auth/expo` (1.7.17: `MAX_STORAGE_CHUNKS`) may split a value into; more is never written. */
export const MAX_CHUNKS = 100;

/**
 * The keys a session under `storagePrefix` is kept in, as `@better-auth/expo` names them (`:` written `_`): the
 * cookie and the last session read.
 */
export function sessionKeys(storagePrefix: string): string[] {
  const prefix = storagePrefix.replace(/:/g, "_");
  return [`${prefix}_cookie`, `${prefix}_session_data`];
}

/**
 * Every item `key` may be stored in: itself (a value, or the marker of a chunked one) and the chunks `@better-auth/expo`
 * writes for a long value, `<key>.<n>` and, in its two alternating slots, `<key>.0.<n>` and `<key>.1.<n>`.
 */
function chunkPrefixes(key: string): string[] {
  return [key, `${key}.0`, `${key}.1`];
}

/**
 * Writes `keys` again through `store` (a `lockedReadable` one), with every chunk `@better-auth/expo` split them into,
 * so items kept before this build become readable on the lock screen too. Run at launch, when the phone is unlocked;
 * an item that cannot be read or written is left as it was, and the next launch tries again. An item is written back
 * only when a second read just before still finds the same value, so a session the auth client saved meanwhile is not
 * put back to what it was (the window left is between that read and the write).
 */
export async function keepReadable(store: KeyStore, keys: readonly string[]): Promise<void> {
  const rewrite = async (item: string): Promise<"missing" | "kept"> => {
    let value: string | null;
    try {
      value = await store.getItemAsync(item);
    } catch {
      return "kept";
    }
    // A chunk cleared by `@better-auth/expo` is written empty: like a missing one, it ends the run.
    if (value === null || value === "") return "missing";
    try {
      if ((await store.getItemAsync(item)) !== value) return "kept";
      await store.setItemAsync(item, value);
    } catch {
      // Left as it was: the next launch tries again.
    }
    return "kept";
  };
  for (const key of keys) {
    await rewrite(key);
    for (const prefix of chunkPrefixes(key)) {
      // Chunks run from 0 with no gap: the first missing one ends the value.
      for (let index = 0; index < MAX_CHUNKS; index++) {
        if ((await rewrite(`${prefix}.${index}`)) === "missing") break;
      }
    }
  }
}
