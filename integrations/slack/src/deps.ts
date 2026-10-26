// What every request handler needs, passed in so tests can hand in a fake bridge, a fake Slack and a clock.

import type { SlackBridgeApi } from "./bridge.ts";
import type { Fetch } from "./web-api.ts";

export type Deps = {
  bridge: SlackBridgeApi;
  signingSecret: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  dashboardUrl: string | undefined;
  fetch: Fetch;
  now: () => number;
  waitUntil: (promise: Promise<unknown>) => void;
};

/** One structured JSON line per problem. Never a token, an email or a request body. */
export function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, worker: "slack", ...fields }));
}
