// Sign-up hands out no session (RFC 0002 "Auth": its answer is the same whether or not the address was taken), so a
// test's session comes from signing in after it, as the dashboard and the app do.
import { exports } from "cloudflare:workers";

let ips = 0;

/** Signs in and answers the session's `Cookie` header. From client IPs of its own (198.18.0.0/15, the benchmarking block), so no test's per-IP count sees them. */
export async function sessionCookie(
  email: string,
  password: string,
  origin = "http://api.test",
): Promise<string> {
  const response = await exports.default.fetch(`${origin}/auth/sign-in/email`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "cf-connecting-ip": `198.18.${(++ips >> 8) & 255}.${ips & 255}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200) throw new Error(`Signing in failed: ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
