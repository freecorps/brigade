// The "Local stack" check: two calls through the web Worker (/api/*) to the API Worker, one of which
// round-trips through the signed-in member's WorkspaceDO SQLite (members only, apps/api src/index.ts
// `workspaceInfo`). Pure functions here; the React provider lives in src/components/stack-status.tsx.

export const CHECK_TIMEOUT_MS = 8000;

export type CheckFailure =
  | { reason: "network" }
  /** The web Worker answered, but its `API` service binding failed (502 `api_unreachable`). */
  | { reason: "unreachable" }
  | { reason: "timeout" }
  | { reason: "http"; status: number }
  | { reason: "invalid" };

export type CheckResult<T> =
  | { ok: true; data: T; ms: number }
  | ({ ok: false; ms: number } & CheckFailure);

export interface WorkspaceInfo {
  workspace: string;
  tables: number;
  databaseSize: number;
}

export interface StackReport {
  health: CheckResult<true>;
  workspace: CheckResult<WorkspaceInfo>;
  checkedAt: Date;
}

export type StackVerdict = "ok" | "api-down" | "do-down";

export function parseHealth(body: unknown): true | undefined {
  return isRecord(body) && body.ok === true ? true : undefined;
}

export function parseWorkspace(body: unknown): WorkspaceInfo | undefined {
  if (!isRecord(body)) return undefined;
  const { workspace, tables, databaseSize } = body;
  if (typeof workspace !== "string") return undefined;
  if (!isCount(tables) || !isCount(databaseSize)) return undefined;
  return { workspace, tables, databaseSize };
}

/**
 * Why /health failed, for the hint: `down` (nothing answered: start the stack), `erroring` (the API
 * Worker answered with an error) or `stuck` (it took longer than the deadline, so it is most likely
 * running but hung). For the last two the fix is in its logs, not in starting the stack.
 */
export function healthFault(
  health: CheckResult<unknown>,
): "down" | "erroring" | "stuck" | undefined {
  if (health.ok) return undefined;
  if (health.reason === "http" || health.reason === "invalid") return "erroring";
  if (health.reason === "timeout") return "stuck";
  return "down";
}

/** The API Worker is down when /health fails; the DO is down when only the workspace call fails. */
export function verdict(report: Pick<StackReport, "health" | "workspace">): StackVerdict {
  if (!report.health.ok) return "api-down";
  return report.workspace.ok ? "ok" : "do-down";
}

export async function check<T>(
  fetcher: typeof fetch,
  path: string,
  parse: (body: unknown) => T | undefined,
  {
    timeoutMs = CHECK_TIMEOUT_MS,
    now = () => performance.now(),
    signal,
  }: { timeoutMs?: number; now?: () => number; signal?: AbortSignal } = {},
): Promise<CheckResult<T>> {
  const started = now();
  const elapsed = () => Math.round(now() - started);
  const timeout = AbortSignal.timeout(timeoutMs);
  // The caller's signal cancels the request too (the page unmounting, a newer check starting).
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetcher(path, { signal: combined, headers: { accept: "application/json" } });
  } catch {
    return { ok: false, ms: elapsed(), reason: timeout.aborted ? "timeout" : "network" };
  }
  let body: unknown;
  try {
    body = await readJson(response, combined);
  } catch {
    // The deadline can pass while the body streams in; that is a timeout, not a bad answer.
    if (timeout.aborted) return { ok: false, ms: elapsed(), reason: "timeout" };
    body = undefined;
  }
  if (!response.ok) {
    if (response.status === 502 && isRecord(body) && body.error === "api_unreachable") {
      return { ok: false, ms: elapsed(), reason: "unreachable" };
    }
    return { ok: false, ms: elapsed(), reason: "http", status: response.status };
  }
  if (body === undefined) return { ok: false, ms: elapsed(), reason: "invalid" };
  const data = parse(body);
  return data === undefined
    ? { ok: false, ms: elapsed(), reason: "invalid" }
    : { ok: true, data, ms: elapsed() };
}

/** The workspace call's path, for the member's workspace. */
export function workspacePath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}`;
}

export async function checkStack(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<StackReport> {
  const [health, workspace] = await Promise.all([
    check(fetcher, "/api/health", parseHealth, { signal }),
    check(fetcher, workspacePath(workspaceId), parseWorkspace, { signal }),
  ]);
  return { health, workspace, checkedAt: new Date() };
}

/** `response.json()` that also gives up when `signal` aborts (a stub or a proxy may ignore it). */
function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    // The body is locked by json(), so it cannot be cancelled from here; with a real fetch the
    // same signal already aborts it. This only stops waiting.
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    response
      .json()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
