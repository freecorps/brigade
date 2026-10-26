// Pure helpers for the live incident list: which status moves to offer, what to say about the connection, how to
// check a declare before sending it, and how to word a mutation the shard refused. Shared with the mobile app: the
// wording from packages/i18n, the rest from packages/sync.
import type { Notice } from "@freecorps/brigade-i18n/incident";

// How the list reads the connection, shared with the mobile app (packages/sync, view.ts).
export { nextFailed, syncView, type SyncView } from "@freecorps/brigade-sync";
export { adjustBusy, checkDeclare, nextStatuses } from "@freecorps/brigade-sync";
export {
  formatAge,
  mutationErrorReason,
  noticeFor,
  noticeSubject,
  noticeText,
  queryErrorReason,
  type Notice,
  type NoticePlace,
  type NoticeReason,
  type NoticeTarget,
} from "@freecorps/brigade-i18n/incident";

/** Whether the shard refused a declare for its title (give the text back), not for the clock. */
export function titleRefused(notice: Notice | undefined): boolean {
  return notice?.kind === "declare" && notice.reason === "invalid_args";
}

let opened: number | null = null;

/** Notes the incident whose page the list's title link opened, so the list can put focus back on it. */
export function rememberOpened(number: number): void {
  opened = number;
}

/** The incident `rememberOpened` noted, once: a later visit to the list starts at the top as usual. */
export function takeOpened(): number | null {
  const number = opened;
  opened = null;
  return number;
}
