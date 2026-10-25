import { TARGETS, TIMEOUT_MS, TRACE_URL, type Target } from "./config.ts";

/** One target's result: time to response headers, or why there was none. */
export type Timing = { ms: number; status: number } | { ms: null; error: string };

export type Measurement = {
  /** IATA code of the colo `/cdn-cgi/trace` reports, or from `cf-ray` if the body has none. */
  colo: string | null;
  /** Country of the egress address, as the trace reports it (`loc`). */
  loc: string | null;
  trace: Timing;
  targets: Record<Target, Timing>;
};

/**
 * Takes one sample: the trace first (where this object runs), then each target in turn, so the timings do not
 * compete with each other. Never throws: failures are recorded as errors.
 */
export async function measure(fetcher: typeof fetch = fetch): Promise<Measurement> {
  let colo: string | null = null;
  let loc: string | null = null;
  const trace = await time(fetcher, TRACE_URL, "GET", async (response) => {
    const fields = parseTrace(await response.text());
    colo = fields.colo ?? rayColo(response.headers.get("cf-ray"));
    loc = fields.loc ?? null;
  });
  const targets = {} as Record<Target, Timing>;
  for (const [name, url] of Object.entries(TARGETS) as [Target, string][]) {
    targets[name] = await time(fetcher, url, "HEAD", async (response) => {
      await response.body?.cancel();
    });
  }
  return { colo, loc, trace, targets };
}

async function time(
  fetcher: typeof fetch,
  url: string,
  method: "GET" | "HEAD",
  read: (response: Response) => Promise<void>,
): Promise<Timing> {
  // Workers clocks advance only across I/O, which is exactly what is being timed.
  const start = Date.now();
  try {
    const response = await fetcher(url, {
      method,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    await read(response);
    return { ms, status: response.status };
  } catch (error) {
    return { ms: null, error: error instanceof Error ? error.name : String(error) };
  }
}

/** `/cdn-cgi/trace` is `key=value` lines. */
export function parseTrace(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return fields;
}

/** A `cf-ray` header ends in the colo: `8f1c2d3e4a5b6c7d-GRU`. */
export function rayColo(ray: string | null): string | null {
  const colo = ray?.split("-").at(-1);
  return colo && /^[A-Z]{3}$/.test(colo) ? colo : null;
}
