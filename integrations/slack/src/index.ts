// The Slack app's Worker (RFC 0011): the entry, and nothing else (every export of a Worker's entry must be a
// handler). The requests are handled in src/app.ts.

import type { SlackBridgeApi } from "./bridge.ts";
import { handle } from "./app.ts";

/** The Worker's bindings, with the API's entrypoint typed by its contract (wrangler types it as a plain `Service`). */
export type SlackEnv = Omit<Env, "API"> & { API: SlackBridgeApi };

export default {
  fetch: (request, env, ctx) =>
    handle(request, {
      bridge: env.API,
      signingSecret: env.SLACK_SIGNING_SECRET,
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      dashboardUrl: env.DASHBOARD_URL,
      fetch: (request) => fetch(request),
      now: () => Date.now(),
      waitUntil: (promise) => ctx.waitUntil(promise),
    }),
} satisfies ExportedHandler<SlackEnv>;
