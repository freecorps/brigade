// The "Local stack" check: two calls through the web Worker (/api/*) to the API Worker, one of which
// round-trips through a WorkspaceDO's SQLite. Pure functions here; the React hook lives in
// src/components/stack-status.tsx.

export const DEMO_WORKSPACE = "demo";
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

/** The API Worker is down when /health fails; the DO is down when only the workspace call fails. */
export function verdict(report: Pick<StackReport, "health" | "workspace">): StackVerdict {
  if (!report.health.ok) return "api-down";
  return report.workspace.ok ? "ok" : "do-down";
}

export async function check<T>(
  fetcher: typeof fetch,
  path: string,
  parse: (body: unknown) => T | undefined,
  { timeoutMs = CHECK_TIMEOUT_MS, now = () => performance.now() } = {},
): Promise<CheckResult<T>> {
  const started = now();
  const elapsed = () => Math.round(now() - started);
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetcher(path, { signal, headers: { accept: "application/json" } });
  } catch {
    return { ok: false, ms: elapsed(), reason: signal.aborted ? "timeout" : "network" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
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

export async function checkStack(fetcher: typeof fetch = fetch): Promise<StackReport> {
  const [health, workspace] = await Promise.all([
    check(fetcher, "/api/health", parseHealth),
    check(fetcher, `/api/workspaces/${DEMO_WORKSPACE}`, parseWorkspace),
  ]);
  return { health, workspace, checkedAt: new Date() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
