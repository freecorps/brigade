// The dashboard's "Use the app" QR and link (RFC 0015 sections 5 and 6): `brigade://connect?server=<origin>` adds an
// instance by its address; with `&code=<code>` it also signs the phone in, once the member approves on the dashboard
// (src/lib/qr-sign-in.ts). Opened by the system camera (a deep link, src/app/connect.tsx) or the app's own scanner.
// Pure, so it is tested in Node. The query is read by hand: React Native's `URL` has no working `searchParams`.

/** A sign-in code as `POST /api/app-sign-in` makes one: 16 random bytes, base64url. */
export const SIGN_IN_CODE = /^[A-Za-z0-9_-]{22}$/;

export type ConnectLink = {
  /** The address as given; src/lib/instance-address.ts `readAddress` decides whether the app goes there. */
  server: string;
  code?: string;
};

/** The query of `value` (after `?`, before `#`), decoded; repeated keys keep the first. */
export function queryOf(value: string): Map<string, string> {
  const query = value.split("#")[0]!.split("?").slice(1).join("?");
  const found = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const at = pair.indexOf("=");
    const rawKey = at === -1 ? pair : pair.slice(0, at);
    const rawValue = at === -1 ? "" : pair.slice(at + 1);
    let key: string;
    let decoded: string;
    try {
      key = decodeURIComponent(rawKey.replaceAll("+", " "));
      decoded = decodeURIComponent(rawValue.replaceAll("+", " "));
    } catch {
      continue;
    }
    if (!found.has(key)) found.set(key, decoded);
  }
  return found;
}

/**
 * What a scanned or opened link asks: `brigade://connect?server=…[&code=…]` (also `brigade:///connect`, as some
 * readers write it). A bare `https://` address (a QR of the dashboard's own address) is the address alone. Undefined
 * for anything else, and for a code that is not shaped like one (no request goes out for it).
 */
export function parseConnectLink(value: string): ConnectLink | undefined {
  const text = value.trim();
  if (/^https:\/\/[^\s]+$/i.test(text)) return { server: text };
  const match = /^brigade:\/\/\/?connect\/?(?:[?#]|$)/i.exec(text);
  if (!match) return undefined;
  const query = queryOf(text);
  return connectParams(query.get("server"), query.get("code"));
}

let scanned: string | undefined;

function linkKey(link: ConnectLink): string {
  return `${link.server}\n${link.code ?? ""}`;
}

/**
 * The in-app scanner's link, marked before it opens the connect route: only that one goes straight to its checks. A
 * `brigade://connect` opened from anywhere else (any app or web page can open one, with any params) waits for the
 * member's Continue before the app asks anything of the address.
 */
export function markScanned(link: ConnectLink): void {
  scanned = linkKey(link);
}

/** Whether `link` is the one the scanner just marked; true once. */
export function takeScanned(link: ConnectLink | undefined): boolean {
  if (!link || scanned === undefined || scanned !== linkKey(link)) return false;
  scanned = undefined;
  return true;
}

/**
 * The same from the route's search params (expo-router hands `brigade://connect?…` to src/app/connect.tsx as
 * `/connect` with them). A param given twice comes as an array: refused, as a link nobody made.
 */
export function connectParams(server: unknown, code: unknown): ConnectLink | undefined {
  if (typeof server !== "string" || server.trim() === "") return undefined;
  if (code === undefined || code === "") return { server: server.trim() };
  if (typeof code !== "string" || !SIGN_IN_CODE.test(code)) return undefined;
  return { server: server.trim(), code };
}
