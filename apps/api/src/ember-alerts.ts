// `POST /alerts/:token`'s call into a workspace's shard (RFC 0005 "Alert sources", RFC 0016 "Parity"), sent to the
// engine D1's `workspace_engine` names: `WorkspaceDO.alert` / `alertTooLarge`, or on Ember the same checks here, in
// the Worker (a mutation cannot run crypto), over the source and secrets the shard holds, and the payload ingested on
// the shard (ember/alerts.ts). The engine is read as a page's is (`pageEngine`: cached, bounded, falling back to the
// last known), since an alert lost to a slow D1 is worse than one sent to the engine last known.

import type { AlertHeaders, AlertSourceRow } from "@freecorps/brigade-schema";
import {
  readPayload,
  signed,
  verifiedSource,
  type AlertIntakeResult,
  type AlertPayload,
  type AlertSourceSecret,
} from "./alert-intake.ts";
import { pageEngine } from "./ember-paging.ts";
import { emberMutation } from "./ember-workspace.ts";

type AlertsEnv = Pick<Env, "DB" | "WORKSPACE" | "ALERT_LIMIT"> & { SHARD?: Env["SHARD"] };

/** `WorkspaceDO`'s two alert calls. */
export type WorkspaceAlerts = {
  alert(
    sourceId: string,
    digest: ArrayBuffer,
    body: ArrayBuffer,
    headers: AlertHeaders,
  ): Promise<AlertIntakeResult>;
  alertTooLarge(
    sourceId: string,
    digest: ArrayBuffer,
    headers: AlertHeaders,
  ): Promise<AlertIntakeResult>;
};

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** `workspaceId`'s alert calls, on `WorkspaceDO` or on Ember. */
export async function workspaceAlerts(
  env: AlertsEnv,
  workspaceId: string,
): Promise<WorkspaceAlerts> {
  if (env.SHARD && (await pageEngine(env.DB, workspaceId)) === "ember") {
    return emberAlerts({ ...env, SHARD: env.SHARD }, workspaceId);
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    alert: async (...args) => stub.alert(...args),
    alertTooLarge: async (...args) => stub.alertTooLarge(...args),
  };
}

/**
 * The alert calls on a workspace's Ember shard, as `AlertIntake.receive` and `receiveTooLarge` run them: the source's
 * secrets checked here in constant time, its rate spent only then (`ALERT_LIMIT`, failing open), then the payload
 * read here and ingested on the shard.
 */
export function emberAlerts(
  env: AlertsEnv & { SHARD: Env["SHARD"] },
  workspaceId: string,
): WorkspaceAlerts {
  const held = (sourceId: string) =>
    emberMutation<{ source: AlertSourceRow | null; secret: AlertSourceSecret | null } | null>(
      env,
      workspaceId,
      "alerts:source",
      { workspaceId, sourceId },
    );
  const allowed = async (sourceId: string) => {
    try {
      const { success } = await env.ALERT_LIMIT.limit({ key: `${workspaceId}:${sourceId}` });
      if (!success) log("alert source over its rate", { source: sourceId });
      return success;
    } catch (error) {
      // A lost alert is worse than a busy shard.
      log("alert rate limit failed", { source: sourceId, error: String(error) });
      return true;
    }
  };
  const ingest = (sourceId: string, payload: AlertPayload) =>
    emberMutation<AlertIntakeResult>(env, workspaceId, "alerts:ingest", {
      workspaceId,
      sourceId,
      payload,
    });
  return {
    async alert(sourceId, digest, body, headers) {
      const found = await held(sourceId);
      const source = await verifiedSource(
        found?.source ?? undefined,
        found?.secret ?? undefined,
        digest,
        headers,
      );
      if (!source || !(await signed(source, found!.secret!, body, headers))) {
        return { status: "not_found" };
      }
      if (!(await allowed(sourceId))) return { status: "busy" };
      const payload = readPayload(source, body, headers, log);
      if (payload === "ignored") return { status: "ignored" };
      return ingest(sourceId, payload);
    },
    async alertTooLarge(sourceId, digest, headers) {
      const found = await held(sourceId);
      const source = await verifiedSource(
        found?.source ?? undefined,
        found?.secret ?? undefined,
        digest,
        headers,
      );
      if (!source) return { status: "not_found" };
      if (!(await allowed(sourceId))) return { status: "busy" };
      return ingest(sourceId, { kind: "too_large" });
    },
  };
}
