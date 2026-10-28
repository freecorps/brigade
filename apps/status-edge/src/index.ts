// The status page edge's Worker (RFC 0012 "Custom domains"): the entry, and nothing else (every export of a Worker's
// entry must be a handler). The requests are answered in src/edge.ts.

import type { StatusPagesApi } from "./api.ts";
import { serveEdge } from "./edge.ts";

/** The Worker's bindings, with the API's entrypoint typed by its contract (wrangler types it as a plain `Service`). */
export type EdgeEnv = Omit<Env, "API"> & { API: StatusPagesApi };

export default {
  fetch: (request, env) => serveEdge(request, env),
} satisfies ExportedHandler<EdgeEnv>;
