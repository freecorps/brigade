// Writes packages/sdk/tests/fixtures/server-signed.json: deliveries signed by this API's signer (src/webhook-sign.ts),
// for the SDK's verifier to check without importing app code. Run with `vp run sdk-fixture` in this package;
// test/webhooks.test.ts fails while the committed file differs from what this writes.
import { writeFileSync } from "node:fs";
import { serverSignedFixtureJson } from "../test/sdk-fixture.ts";

writeFileSync(
  new URL("../../../packages/sdk/tests/fixtures/server-signed.json", import.meta.url),
  await serverSignedFixtureJson(),
);
