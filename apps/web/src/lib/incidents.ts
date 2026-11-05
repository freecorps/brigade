// Pure helpers for the live incident list: which status moves to offer, what to say about the connection, how to
// check a declare before sending it, and how to word a mutation the shard refused. Shared with the mobile app: the
// wording from packages/i18n, the rest from packages/sync.
import type { Notice } from "@freecorps/brigade-i18n/incident";
import type { IncidentRow, Severity } from "@freecorps/brigade-schema";

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

/** The severities a phone folds behind "Show N lower-severity incidents" while the list is sorted most severe first. */
const LOWER = new Set<Severity>(["sev3", "sev4"]);

/** SEV3 or SEV4: what a phone may fold away. */
export function isLowerSeverity(severity: Severity): boolean {
  return LOWER.has(severity);
}

export type Fold = {
  /** Rows a phone does not draw until the user asks for them. Empty when nothing folds. */
  folded: ReadonlySet<string>;
  /** Whether the toggle shows at all: there is something to fold, or it was unfolded and can fold again. */
  toggle: boolean;
  /** How many lower-severity rows the toggle stands for. */
  count: number;
};

/**
 * Which rows a phone folds away. Only SEV3 and SEV4, and only when at least one SEV1 or SEV2 stays: with none,
 * folding would leave a toggle and nothing else, so everything shows. `keep` never folds (the incident the user
 * came back from, a row they declared, re-ranked or focused here), nor does a row the shard has not numbered yet
 * (a monitor's link jumps to it, and it has no page of its own to find it on). The list must be sorted most severe
 * first (`incidents.active` is), so the folded rows are its tail and the toggle can sit under the list.
 */
export function foldLowerSeverity(
  rows: readonly Pick<IncidentRow, "id" | "number" | "severity">[],
  expanded: boolean,
  keep: ReadonlySet<string>,
): Fold {
  const none: Fold = { folded: new Set(), toggle: false, count: 0 };
  if (!rows.some((row) => !LOWER.has(row.severity))) return none;
  const lower = rows.filter(
    (row) => LOWER.has(row.severity) && row.number !== null && !keep.has(row.id),
  );
  if (lower.length === 0) return none;
  return {
    folded: expanded ? new Set() : new Set(lower.map((row) => row.id)),
    toggle: true,
    count: lower.length,
  };
}
