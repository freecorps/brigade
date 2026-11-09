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

/** How many chunks `@better-auth/expo` may split a value into (`<key>.0`, `<key>.1`, …); more is never written. */
const MAX_CHUNKS = 64;

/**
 * The keys a session under `storagePrefix` is kept in, as `@better-auth/expo` names them (`:` written `_`): the
 * cookie and the last session read.
 */
export function sessionKeys(storagePrefix: string): string[] {
  const prefix = storagePrefix.replace(/:/g, "_");
  return [`${prefix}_cookie`, `${prefix}_session_data`];
}

/**
 * Writes `keys` again through `store` (a `lockedReadable` one), with each chunk `@better-auth/expo` split them into,
 * so items kept before this build become readable on the lock screen too. Run at launch, when the phone is unlocked;
 * an item that cannot be read or written is left as it was, and the next launch tries again.
 */
export async function keepReadable(store: KeyStore, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    for (const each of [key, ...Array.from({ length: MAX_CHUNKS }, (_, i) => `${key}.${i}`)]) {
      let value: string | null;
      try {
        value = await store.getItemAsync(each);
      } catch {
        continue;
      }
      // Chunks run from 0 with no gap: the first missing one ends the value.
      if (value === null) {
        if (each === key) continue;
        break;
      }
      await store.setItemAsync(each, value).catch(() => {});
    }
  }
}
