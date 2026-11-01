/**
 * Whether an `Authorization` header is `Bearer <expected>`. Compares SHA-256 digests in constant time, so the check
 * leaks neither the token nor its length. An empty or missing `expected` (the secret is not set) matches nothing.
 * Used for `RELAY_SEND_TOKEN` (`/send`, `/health?deep=1`) and `RELAY_ADMIN_TOKEN` (closed registration).
 */
export async function bearerMatches(
  header: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected || header === null || !header.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header.slice("Bearer ".length))),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
