// How on-call schedules read in a UI, shared by the dashboard's On-call card and the app's on-call screen (RFC 0003
// "Schedules"): who someone is, a handoff time in the schedule's zone and in the viewer's, a zone's name and offset,
// and why a schedule change was refused. Pure: the current locale for the messages, an explicit one for times.
import { zoneOffset, type MemberRow } from "@freecorps/brigade-schema";
import { formatDateTime, formatRelativeTime } from "./format.ts";
import { mutationErrorReason } from "./incident.ts";
import { m } from "./paraglide/messages.js";
import type { Locale } from "./paraglide/runtime.js";

const MINUTE = 60_000;

/** A member's name from the shard's list, or "Unnamed member" when it has none (or no longer lists them). */
export function memberLabel(members: readonly MemberRow[], userId: string): string {
  return members.find((member) => member.id === userId)?.name || m.oncall_unnamed();
}

/** The zone's short name at `instant` in `locale` ("GMT-3", "BRT", "CET"), or "" if the runtime has none. */
function zoneName(instant: number, timeZone: string, locale: Locale): string {
  try {
    return (
      new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
        .formatToParts(instant)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

/**
 * A handoff time in `timeZone`, saying which zone: "Mon, Oct 27, 9:00 AM GMT-3", the time in the locale's short
 * style.
 */
export function handoffTime(instant: number, timeZone: string, locale: Locale): string {
  const date = formatDateTime(instant, locale, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = formatDateTime(instant, locale, timeZone, { timeStyle: "short" });
  const zone = zoneName(instant, timeZone, locale);
  return `${date}, ${time}${zone ? ` ${zone}` : ""}`;
}

/**
 * The same instant on the viewer's clock ("Tue, Oct 28, 7:00 AM GMT-3 your time"), or null when their clock
 * reads the same as the schedule's then.
 */
export function viewerTime(
  instant: number,
  timeZone: string,
  viewerZone: string,
  locale: Locale,
): string | null {
  if (zoneOffset(instant, timeZone) === zoneOffset(instant, viewerZone)) return null;
  return text("your_time", { time: handoffTime(instant, viewerZone, locale) });
}

/** "in 19 hours". */
export const fromNow = (instant: number, now: number, locale: Locale) =>
  formatRelativeTime(instant, locale, now);

/** `oncall_text` with only the inputs the variant uses. */
export function text(
  key:
    | "your_time"
    | "members_max"
    | "choose_person"
    | "remove_override"
    | "layer_hidden"
    | "dropped_members",
  inputs: { name?: string; max?: string; time?: string } = {},
): string {
  return m.oncall_text({ text: key, name: "", max: "", time: "", ...inputs });
}

/**
 * The names IANA uses today for zones some runtimes still list under an older one (V8's ICU says
 * "Asia/Calcutta"; IANA's `zone.tab` says "Asia/Kolkata"). Schedules keep storing the runtime's spelling (any
 * runtime accepts either); this is only for reading and finding them. Found by diffing V8's
 * `Intl.supportedValuesOf("timeZone")` against IANA's `zone.tab`.
 */
const MODERN_ZONES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** An IANA zone as people read it, by its current name: "America/Sao Paulo", "Asia/Kolkata" for "Asia/Calcutta". */
export const zoneLabel = (zone: string) => (MODERN_ZONES[zone] ?? zone).replaceAll("_", " ");

/** A zone's offset from UTC at `instant`: "UTC+00:00", "UTC+05:45", "UTC-03:00". */
export function offsetLabel(timeZone: string, instant: number): string {
  const minutes = Math.round(zoneOffset(instant, timeZone) / MINUTE);
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `UTC${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Why the shard refused a schedule change, in the shared wording, with "gone" for a deleted schedule. */
export function scheduleRefusal(code: string): string {
  if (code === "not_found") return m.oncall_gone();
  return mutationErrorReason(code);
}
