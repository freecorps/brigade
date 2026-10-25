/**
 * Plays the instance's part for spike S1: seals a push for one device and sends it through a relay.
 *
 *   RELAY_URL=https://brigade-relay-dev.<subdomain>.workers.dev \
 *   RELAY_TOKEN_FILE=~/.config/brigade/relay-dev-token \
 *   vp run send-test-push -- <device token hex> <device public key base64url> [title] [body] [urgency]
 *
 * The device token and public key are what the app's dev screen shows. The token is read from a file so it
 * never lands in shell history.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { sealPush } from "@freecorps/brigade-push";

const [
  deviceToken,
  publicKey,
  title = "SEV1 · Checkout down",
  body = "502s from payments",
  urgency = "page",
] = process.argv.slice(2);
const url = process.env.RELAY_URL;
const tokenFile = process.env.RELAY_TOKEN_FILE?.replace(/^~(?=\/)/, homedir());
if (!deviceToken || !publicKey || !url || !tokenFile) {
  console.error(
    "usage: RELAY_URL=… RELAY_TOKEN_FILE=… send-test-push <device token> <public key> [title] [body] [urgency]",
  );
  process.exit(2);
}

const envelope = await sealPush(publicKey, { title, body });
const response = await fetch(new URL("/send", url), {
  method: "POST",
  headers: {
    Authorization: `Bearer ${readFileSync(tokenFile, "utf8").trim()}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ deviceToken, envelope, urgency }),
});
console.log(response.status, await response.text());
process.exitCode = response.ok ? 0 : 1;
