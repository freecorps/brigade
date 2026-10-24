/** `window.localStorage`, or undefined where reading the property itself throws (blocked storage). */
export function getStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
