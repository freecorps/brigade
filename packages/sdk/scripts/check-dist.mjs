// After `vp pack`: the built package imports in plain Node (no workspace conditions), exports what the README shows,
// verifies the Standard Webhooks example, and imports nothing: the schema package is bundled, so the published files
// pull in no AGPL code and no workspace package (RFC 0009).
import { readdirSync, readFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const files = readdirSync(dist).filter((file) => /\.(m?js|d\.m?ts)$/.test(file));
const failures = [];
for (const file of files) {
  const text = readFileSync(new URL(file, dist), "utf8");
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
    if (!match[1].startsWith("./")) failures.push(`${file} imports ${match[1]}`);
  }
}

const sdk = await import(new URL("index.mjs", dist).href);
for (const name of ["verifyWebhook", "createClient", "BrigadeApiError", "WEBHOOK_EVENT_TYPES"]) {
  if (sdk[name] === undefined) failures.push(`dist/index.mjs does not export ${name}`);
}
// spec/standard-webhooks.md, "Signature scheme": a valid signature over a body that is no Brigade payload.
const result = await sdk.verifyWebhook({
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  headers: {
    "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
    "webhook-timestamp": "1614265330",
    "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  },
  body: '{"test": 2432232314}',
  now: 1614265330 * 1000,
});
if (result.ok || result.error.code !== "invalid_payload") {
  failures.push(
    `the built verifier answered ${JSON.stringify(result)} for the specification's example`,
  );
}

// Deliveries Brigade's API signed (tests/fixtures/server-signed.json): the bundled validators still parse them.
const fixture = JSON.parse(
  readFileSync(new URL("../tests/fixtures/server-signed.json", import.meta.url), "utf8"),
);
for (const delivery of fixture.deliveries) {
  const verified = await sdk.verifyWebhook({
    secret: fixture.secrets,
    now: fixture.now,
    ...delivery,
  });
  if (!verified.ok)
    failures.push(
      `the built verifier refused ${delivery.headers["webhook-id"]}: ${verified.error.code}`,
    );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`dist: ${files.length} files, self-contained`);
