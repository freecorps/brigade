export type LocalizedString = import('../runtime.js').LocalizedString;
export type Timeline_EntryInputs = {
    kind: NonNullable<unknown>;
    actor: NonNullable<unknown>;
    a: NonNullable<unknown>;
    b: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, actor: NonNullable<unknown>, a: NonNullable<unknown>, b: NonNullable<unknown> }} Timeline_EntryInputs */
/**
* | kind | output |
* | --- | --- |
* | "declared" | "{actor} declared the incident as {a}" |
* | "status_changed" | "{actor} changed the status from {a} to {b}" |
* | "severity_changed" | "{actor} changed the severity from {a} to {b}" |
* | "acknowledged" | "{actor} acknowledged the page" |
* | "role_assigned" | "{actor} made {b} {a}" |
* | "role_unassigned" | "{actor} removed {b} as {a}" |
* | "role_taken" | "{actor} took the {a} role" |
* | "role_left" | "{actor} stepped down as {a}" |
* | "update" | "{actor} posted an update" |
* | "alert_recovered" | "{a} recovered, so its alert resolved" |
* | "alert_paused" | "{actor} paused {a}, so its alert resolved" |
* | "alert_deleted" | "{actor} deleted {a}, so its alert resolved" |
* | "page_failed_undelivered" | "Couldn't page {a}: the push didn't go through" |
* | "page_failed_unsupported" | "Couldn't page {a}: Brigade can't push to Android phones yet" |
* | "page_failed_not_configured" | "Couldn't page {a}: push notifications aren't set up on this server" |
* | "page_failed_no_devices" | "Couldn't page {a}: no registered device" |
* | "page_failed_over_limit" | "Couldn't page {a}: this page went to too many phones" |
* | "page_nobody" | "Nobody was paged: no one who can respond has Brigade on their phone" |
* | "page_dead_lettered" | "A page may not have gone out: Brigade kept failing to send it" |
* | "page_failed_not_a_member" | "Couldn't page {a}: no longer someone who can respond" |
* | "page_nobody_on_call" | "Couldn't page {a}: nobody on call" |
* | "page_schedule_missing" | "Couldn't page a schedule that was deleted" |
* | "escalated_started" | "Paged level {a}: {b}" |
* | "escalated_timeout" | "Nobody acknowledged, so level {a} was paged: {b}" |
* | "escalated_unreachable" | "Earlier levels couldn't reach anyone, so level {a} was paged: {b}" |
* | "escalated_everyone" | "No level could reach anyone, so everyone who can respond was paged" |
* | "escalated_everyone_later" | "No later level could reach anyone, so everyone who can respond was paged" |
* | "escalated_started_aware" | "Level {a}: {b}" |
* | "escalated_again" | "Level {a} paged again: the earlier page was lost" |
* | "escalated_everyone_again" | "Everyone who can respond paged again: the earlier page was lost" |
* | "page_nobody_else" | "Nobody else was paged: only the person who declared it can respond" |
* | "escalation_exhausted" | "Nobody acknowledged after every level, so everyone who can respond was paged" |
* | "escalated_everyone_stalled" | "An escalation level kept failing to fire, so everyone who can respond was paged" |
* | "page_escalation_stalled" | "An escalation level couldn't fire. Brigade keeps trying, and pages everyone who can respond if it still can't" |
* | * | "{actor} changed the incident" |
*
* @param {Timeline_EntryInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const timeline_entry: ((inputs: Timeline_EntryInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Timeline_EntryInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
