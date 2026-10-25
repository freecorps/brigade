import {
  HINTS,
  INTERVAL_MS,
  isHint,
  probeName,
  RETENTION_MS,
  TARGETS,
  TRACE_URL,
  type Hint,
} from "./config.ts";

export { ProbeDO } from "./probe.ts";

const ADMIN = /^\/probes\/(start|stop|reset)$/;

/**
 * Spike S2 routes (docs/spikes/s2-probe-placement.md):
 *
 * - `GET /summary[?hours=N]`: the per-hint summary as JSON (colos, timings; nothing sensitive).
 * - `POST /probes/{start,stop,reset}[?hint=H]`: every probe or one.
 * - `GET /probes/samples?hint=H[&hours=N]`: raw samples of one probe.
 *
 * Every route needs `Authorization: Bearer <PROBE_ADMIN_TOKEN>`: even `/summary` wakes all eleven objects and
 * reads days of rows, so it is not left open to anyone who finds the URL.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const action = ADMIN.exec(pathname)?.[1];
    if (action === undefined && pathname !== "/summary" && pathname !== "/probes/samples")
      return json({ error: "not_found" }, 404);
    if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);

    if (pathname === "/summary") {
      if (request.method !== "GET") return methodNotAllowed("GET");
      const since = sinceParam(url);
      if (since === undefined) return json({ error: "invalid_hours" }, 400);
      const probes = await Promise.all(
        HINTS.map(async (hint) => {
          try {
            return { ...(await probe(env, hint).summary(since)), hint };
          } catch (error) {
            return { hint, error: logged("summary failed", hint, error) };
          }
        }),
      );
      return json({
        generatedAt: new Date().toISOString(),
        since: since === 0 ? null : new Date(since).toISOString(),
        intervalSeconds: INTERVAL_MS / 1000,
        trace: TRACE_URL,
        targets: TARGETS,
        probes,
      });
    }

    const hintParam = url.searchParams.get("hint");
    if (hintParam !== null && !isHint(hintParam)) return json({ error: "invalid_hint" }, 400);

    if (action === undefined) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      if (hintParam === null) return json({ error: "hint_required" }, 400);
      const since = sinceParam(url);
      if (since === undefined) return json({ error: "invalid_hours" }, 400);
      return json({ hint: hintParam, samples: await probe(env, hintParam).samples(since) });
    }

    if (request.method !== "POST") return methodNotAllowed("POST");
    const hints = hintParam === null ? HINTS : [hintParam];
    const results = await Promise.all(
      hints.map(async (hint) => {
        try {
          const stub = probe(env, hint);
          const status =
            action === "start"
              ? await stub.start(hint)
              : action === "stop"
                ? await stub.stop()
                : await stub.reset();
          return { ...status, hint };
        } catch (error) {
          return { hint, error: logged(`${action} failed`, hint, error) };
        }
      }),
    );
    return json({ action, probes: results });
  },
} satisfies ExportedHandler<Env>;

/** The hint only takes effect when the object is first created; passing it every time is harmless. */
function probe(env: Env, hint: Hint) {
  return env.PROBE.getByName(probeName(hint), { locationHint: hint });
}

/**
 * `?hours=N` as a lower bound in ms since epoch: 0 without it, undefined when invalid. N is at most the retention
 * window (192 h), which is everything stored anyway, so the bound stays inside `Date`'s range.
 */
function sinceParam(url: URL): number | undefined {
  const hours = url.searchParams.get("hours");
  if (hours === null) return 0;
  const value = Number(hours);
  return Number.isFinite(value) && value > 0 && value * 3_600_000 <= RETENTION_MS
    ? Date.now() - value * 3_600_000
    : undefined;
}

/** Compares SHA-256 digests in constant time, so neither length nor content leaks through timing. */
async function authorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.PROBE_ADMIN_TOKEN;
  const header = request.headers.get("Authorization");
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header.slice("Bearer ".length))),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function logged(message: string, hint: Hint, error: unknown): string {
  console.error(JSON.stringify({ message, hint, error: String(error) }));
  return "probe_unavailable";
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "method_not_allowed" }, 405, { Allow: allow });
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}
