/**
 * Every `locationHint` the installed types accept: RFC 0007's nine, plus `apac-ne` and `apac-se`, which
 * Cloudflare added later as narrower parts of `apac`.
 */
export const HINTS = [
  "wnam",
  "enam",
  "sam",
  "weur",
  "eeur",
  "apac",
  "apac-ne",
  "apac-se",
  "oc",
  "afr",
  "me",
] as const satisfies readonly DurableObjectLocationHint[];

export type Hint = (typeof HINTS)[number];

export function isHint(value: string): value is Hint {
  return (HINTS as readonly string[]).includes(value);
}

/** One probe per hint, as RFC 0007 plans one per workspace and region; `s2` stands in for the workspace. */
export function probeName(hint: Hint): string {
  return `s2:${hint}`;
}

/** Time between samples. RFC 0007's floor is 30 s; 60 s keeps the spike cheap. */
export const INTERVAL_MS = 60_000;

/** Samples older than this are pruned, so storage stays small if the probes are left running. */
export const RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

/** Per-request timeout for every outbound fetch. */
export const TIMEOUT_MS = 5_000;

/**
 * A Cloudflare-proxied page whose `/cdn-cgi/trace` names the colo that received the subrequest: where the
 * object's outbound calls enter Cloudflare's network, hence where it runs.
 */
export const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";

/**
 * Fixed points outside Cloudflare, in three continents, so latency tells roughly where egress is: AWS S3
 * regional endpoints (US East, Frankfurt, Singapore). Only the response headers are timed; bodies are dropped.
 */
export const TARGETS = {
  "aws-us-east-1": "https://s3.us-east-1.amazonaws.com/",
  "aws-eu-central-1": "https://s3.eu-central-1.amazonaws.com/",
  "aws-ap-southeast-1": "https://s3.ap-southeast-1.amazonaws.com/",
} as const;

export type Target = keyof typeof TARGETS;
