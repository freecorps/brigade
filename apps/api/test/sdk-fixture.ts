// Deliveries signed by this API's signer, the way src/notify-webhooks.ts signs them, for packages/sdk's verifier
// (tests/fixtures/server-signed.json; MIT code cannot import this AGPL app). Deterministic: fixed secrets, ids and
// time. scripts/sdk-fixture.ts writes the file; test/webhooks.test.ts fails while it is stale.
import {
  newId,
  webhookPayload,
  type IncidentRow,
  type WebhookSourceEvent,
} from "@freecorps/brigade-schema";
import { signatureHeaders } from "../src/webhook-sign.ts";

/** 2026-10-26T12:00:00Z. */
const T = Date.UTC(2026, 9, 26, 12, 0, 0);
const fill = (byte: number) => (n: number) => new Uint8Array(n).fill(byte);
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Made-up secrets for this fixture only: 32 bytes of 0xFE and of 0xFB. */
export const FIXTURE_SECRETS = [
  `whsec_${toBase64(new Uint8Array(32).fill(0xfe))}`,
  `whsec_${toBase64(new Uint8Array(32).fill(0xfb))}`,
];

export async function serverSignedFixture() {
  const workspaceId = newId("ws", T, fill(1));
  const incident: IncidentRow = {
    id: newId("inc", T, fill(2)),
    number: 142,
    title: "Checkout fora do ar",
    severity: "sev1",
    status: "investigating",
    declaredAt: T,
    declaredBy: "usr_ana",
    acknowledgedAt: null,
    acknowledgedBy: null,
    updatedAt: T,
  };
  const event = (n: number, type: string, data: unknown): WebhookSourceEvent => ({
    id: newId("evt", T, fill(10 + n)),
    type,
    time: new Date(T).toISOString(),
    workspaceId,
    actor: { kind: "user", id: "usr_ana" },
    subject: incident.id,
    data,
  });
  const sources: [WebhookSourceEvent, string[]][] = [
    // During a rotation: signed with both secrets, the current one first.
    [event(1, "incident.declared", { severity: "sev1" }), FIXTURE_SECRETS],
    // Not ASCII: the signature is over the body's UTF-8 bytes.
    [
      event(2, "incident.update_posted", { body: "Revertendo a implantação. ETA 10 min" }),
      FIXTURE_SECRETS.slice(0, 1),
    ],
    [event(3, "webhook.test", { id: newId("whk", T, fill(3)) }), FIXTURE_SECRETS.slice(1)],
  ];
  const timestamp = Math.floor(T / 1000);
  const deliveries = [];
  for (const [source, secrets] of sources) {
    const payload = webhookPayload(source, { incident });
    if (!payload) throw new Error(`No payload for ${source.type}`);
    const body = JSON.stringify(payload);
    deliveries.push({
      headers: await signatureHeaders(secrets, source.id, timestamp, body),
      body,
    });
  }
  return { secrets: FIXTURE_SECRETS, now: T, deliveries };
}

/** The fixture file's exact text. */
export async function serverSignedFixtureJson(): Promise<string> {
  return `${JSON.stringify(await serverSignedFixture(), null, 2)}\n`;
}
