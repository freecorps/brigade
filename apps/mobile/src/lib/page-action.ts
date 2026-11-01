// Acknowledging a page from its notification (RFC 0004 "Clients", RFC 0006 "Paging semantics per platform"): the
// Acknowledge action, sent as `incident.ack` over HTTPS as the signed-in member, and what the phone says after. Pure,
// so it is tested in Node; src/hooks/use-page-actions.ts wires it to expo-notifications, the session and the
// native background time (modules/brigade-push/ios/PageActions.swift).
//
// The names below must match modules/brigade-push/ios/BrigadePage.swift, which sets the category and the ids on a
// decrypted page (the Notification Service Extension) and on the page CallKit's fallback posts.
import type { MutationOutcome, SyncErrorCode } from "@freecorps/brigade-sync";

/** The category of a page that can be acknowledged from its notification. */
export const PAGE_CATEGORY = "brigade_page";
/** Its one action. */
export const ACK_ACTION = "ack";
/** The notification's user info key holding `{ incident, workspace, origin? }`. */
export const PAGE_DATA_KEY = "page";

/**
 * The category as `setNotificationCategoryAsync` takes it, with the action's title in the app's language. The app
 * registers it at launch and whenever its language changes, so a page decrypted later shows the action in it.
 * - Not `opensAppToForeground`: the ack is sent in the background and the app stays closed.
 * - `isAuthenticationRequired`: on a locked phone iOS asks for Face ID or the passcode first. The session lives in
 *   expo-secure-store, readable only while the phone is unlocked, and a locked phone must not let whoever holds it
 *   acknowledge as its owner.
 */
export function pageCategoryActions(ackTitle: string) {
  return [
    {
      identifier: ACK_ACTION,
      buttonTitle: ackTitle,
      options: {
        opensAppToForeground: false,
        isAuthenticationRequired: true,
        isDestructive: false,
      },
    },
  ];
}

/** The parts of an expo-notifications `NotificationResponse` read here. */
export type ActionResponse = {
  actionIdentifier: string;
  notification: {
    request: {
      identifier: string;
      content: {
        title: string | null;
        categoryIdentifier?: string | null;
        data?: Record<string, unknown> | null;
      };
      trigger?: unknown;
    };
  };
};

/** An Acknowledge tap: which notification, which incident in which workspace, and the page's title. */
export type PageAction = {
  notificationId: string;
  incident: string;
  workspace: string;
  title: string;
  /**
   * The instance a version 2 page sealed (RFC 0015 section 4), which the extension checked the phone is paired with;
   * the ack goes there only. Absent from a version 1 page, whose ack goes to the app's instance as before.
   */
  origin?: string;
};

/**
 * The Acknowledge tap in `response`, or null for anything else (a plain tap, another category, a page without its
 * ids). A push's user info is its trigger's `payload` on iOS; a notification the app posted itself (CallKit's
 * fallback, a failed ack's retry) carries it as `data`.
 */
export function pageAction(response: ActionResponse): PageAction | null {
  const { request } = response.notification;
  if (response.actionIdentifier !== ACK_ACTION) return null;
  if (request.content.categoryIdentifier !== PAGE_CATEGORY) return null;
  const payload = record(record(request.trigger)?.payload);
  const page = record(payload?.[PAGE_DATA_KEY]) ?? record(request.content.data?.[PAGE_DATA_KEY]);
  const incident = page?.incident;
  const workspace = page?.workspace;
  if (typeof incident !== "string" || typeof workspace !== "string") return null;
  const origin = page?.origin;
  return {
    notificationId: request.identifier,
    incident,
    workspace,
    title: request.content.title ?? "",
    // Anything but a string is not an origin: no ack goes anywhere for it (`acknowledgeFromNotification`).
    ...(origin === undefined ? {} : { origin: typeof origin === "string" ? origin : "" }),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Which instance a page's tap, Acknowledge, call or receipt goes to (RFC 0015 section 5 "Opening a page"): a version 2
 * page to the instance at its sealed origin, whichever one the app shows, and to none when the phone has no instance
 * there (removed, or never added: nothing is sent); a version 1 page, which names none, to the one the app shows, as
 * before several instances.
 */
export function pageInstance<T extends { origin: string }>(
  page: { origin?: string },
  instances: readonly T[],
  active: T | undefined,
): T | undefined {
  if (page.origin === undefined) return active;
  return instances.find((instance) => instance.origin === page.origin);
}

/**
 * Where an answered call's ack goes: over the open workspace's socket (`sync`) for a call from the instance and
 * workspace the app shows, or one that names no instance (as before several instances); over HTTPS (`http`, the
 * Acknowledge action's route) to the instance it came from otherwise; nowhere (`none`) for an instance not on this
 * phone, or another instance's call without its workspace.
 */
export function callAckRoute<T extends { origin: string }>(
  call: { origin?: string | null; workspace?: string | null },
  instances: readonly T[],
  active: T | undefined,
  openWorkspace: string | undefined,
): { kind: "sync" } | { kind: "http"; instance: T; workspace: string } | { kind: "none" } {
  if (!call.origin) return { kind: "sync" };
  const instance = instances.find((one) => one.origin === call.origin);
  if (!instance) return { kind: "none" };
  const workspace = call.workspace ?? undefined;
  // By origin, not identity: the list and the active instance may come from different snapshots.
  if (
    instance.origin === active?.origin &&
    (workspace === undefined || workspace === openWorkspace)
  ) {
    return { kind: "sync" };
  }
  return workspace === undefined ? { kind: "none" } : { kind: "http", instance, workspace };
}

/** An ack over HTTPS, as the call screen reads a mutation's outcome (`conflict` is acknowledged already). */
export function ackMutationOutcome(outcome: AckOutcome): MutationOutcome {
  if (outcome === "acknowledged") return { ok: true, version: 0 };
  const codes = {
    already: "conflict",
    inactive: "invalid_transition",
    not_found: "not_found",
    forbidden: "forbidden",
    signed_out: "forbidden",
    failed: "closed",
  } as const satisfies Record<Exclude<AckOutcome, "acknowledged">, SyncErrorCode>;
  return { ok: false, error: { code: codes[outcome], message: outcome } };
}

/**
 * How an ack from a notification ended:
 * - `acknowledged`: this member acknowledged it (a retry whose first answer was lost included);
 * - `already`: someone (maybe this member, from the app) acknowledged it first;
 * - `inactive`: the incident was resolved or declined meanwhile;
 * - `not_found`: no such incident in the workspace;
 * - `forbidden`: a viewer, or no longer a member of the workspace;
 * - `signed_out`: no session on the phone, or the server no longer knows it;
 * - `failed`: the server could not be reached or kept failing, within the time iOS gives.
 */
export type AckOutcome =
  | "acknowledged"
  | "already"
  | "inactive"
  | "not_found"
  | "forbidden"
  | "signed_out"
  | "failed";

/** Waits before each try: at once, then twice more. */
export const ACK_RETRY_DELAYS_MS = [0, 2_000, 5_000] as const;
/**
 * Each request's limit. The tries and waits together stay under 25 s, inside the about 30 s of background time iOS
 * gives the app for the action.
 */
export const ACK_REQUEST_TIMEOUT_MS = 6_000;

/** The `Idempotency-Key` header apps/api checks: one per tap, the same on each retry of it. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

export type AckDeps = {
  /** The endpoint for the incident, or undefined when the build has no server. */
  url: (workspaceId: string, incidentId: string) => string | undefined;
  /**
   * The origin of the instance `url` points at (`URL.origin`). A page that names another (`PageAction.origin`) is not
   * acknowledged there: the member is not signed in to its instance on this phone.
   */
  origin?: string;
  /** The session's `Cookie` header; empty when signed out. */
  cookie: () => Promise<string>;
  fetch: (url: string, init: RequestInit) => Promise<Pick<Response, "status" | "json">>;
  /** A new idempotency key (`[\w:-]{1,64}`). */
  key: () => string;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Sends the ack as the signed-in member (`POST /api/workspaces/:id/incidents/:incidentId/ack`), the shard running
 * `incident.ack` with its RBAC and event like an ack from the app. A network failure, a timeout or a server error
 * is tried again on `ACK_RETRY_DELAYS_MS` under the same key, so a request that did land counts once; anything the
 * server refused is not. Never throws.
 */
export async function acknowledgeFromNotification(
  action: Pick<PageAction, "incident" | "workspace" | "origin">,
  deps: AckDeps,
): Promise<AckOutcome> {
  // Only to the instance the page sealed (RFC 0015 section 4); nothing is sent anywhere else.
  if (action.origin !== undefined && action.origin !== deps.origin) return "signed_out";
  const url = deps.url(action.workspace, action.incident);
  if (!url) return "failed";
  let cookie: string;
  try {
    cookie = await deps.cookie();
  } catch {
    return "signed_out";
  }
  if (!cookie) return "signed_out";
  const key = deps.key();
  for (const delay of ACK_RETRY_DELAYS_MS) {
    if (delay > 0) await deps.sleep(delay);
    let response: Pick<Response, "status" | "json">;
    // Not `AbortSignal.timeout`, which Hermes may lack.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ACK_REQUEST_TIMEOUT_MS);
    try {
      response = await deps.fetch(url, {
        method: "POST",
        // No Origin: the API refuses another site's, and the app is none (apps/api/src/index.ts).
        headers: { Cookie: cookie, [IDEMPOTENCY_KEY_HEADER]: key },
        signal: abort.signal,
      });
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
    const outcome = await answered(response);
    if (outcome !== "retry") return outcome;
  }
  return "failed";
}

async function answered(
  response: Pick<Response, "status" | "json">,
): Promise<AckOutcome | "retry"> {
  const { status } = response;
  if (status === 200) return "acknowledged";
  if (status === 401) return "signed_out";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return body?.error === "invalid_transition" ? "inactive" : "already";
  }
  // Overloaded, unavailable or failing: maybe not next time. A 400 is this app's bug and fails at once.
  if (status === 429 || status >= 500) return "retry";
  return "failed";
}

/** The strings the phone says after an ack, from packages/i18n. */
export type AckMessages = Record<AckOutcome, () => string>;

/**
 * The quiet notification that says how the ack ended: the page's title with the outcome, without sound. After
 * `failed` it is a page again, with the Acknowledge action and the same ids, so trying again is one tap away
 * (the fallback when the phone is offline: the instance keeps escalating meanwhile, so nothing waits on it).
 */
export function ackFeedback(
  action: PageAction,
  outcome: AckOutcome,
  messages: AckMessages,
): {
  title: string;
  body: string;
  sound: false;
  interruptionLevel: "passive" | "active";
  categoryIdentifier?: string;
  data?: Record<string, unknown>;
} {
  const base = { title: action.title, body: messages[outcome](), sound: false as const };
  if (outcome !== "failed") return { ...base, interruptionLevel: "passive" };
  return {
    ...base,
    // Seen on the lock screen: the responder thinks the page was handled until it says otherwise.
    interruptionLevel: "active",
    categoryIdentifier: PAGE_CATEGORY,
    data: {
      [PAGE_DATA_KEY]: {
        incident: action.incident,
        workspace: action.workspace,
        ...(action.origin === undefined ? {} : { origin: action.origin }),
      },
    },
  };
}

/**
 * Handles each Acknowledge tap once: expo-notifications may hand the same tap to both the listener and
 * `getLastNotificationResponse` (the tap that launched the app). Keyed by notification, so a later tap on the
 * retry notification (a new notification) is handled too.
 */
export function onceEach(): (notificationId: string) => boolean {
  const seen = new Set<string>();
  return (id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
}
