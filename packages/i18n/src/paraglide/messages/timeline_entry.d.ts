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
* | "renamed" | "{actor} renamed the incident from “{a}” to “{b}”" |
* | "acknowledged" | "{actor} acknowledged the page" |
* | "role_assigned" | "{actor} made {b} {a}" |
* | "role_unassigned" | "{actor} removed {b} as {a}" |
* | "role_taken" | "{actor} took the {a} role" |
* | "role_left" | "{actor} stepped down as {a}" |
* | "update" | "{actor} posted an update" |
* | "update_removed" | "{actor} posted an update, removed by {a}" |
* | "update_removed_own" | "{actor} posted an update and removed it" |
* | "alert_recovered" | "{a} recovered, so its alert resolved" |
* | "alert_paused" | "{actor} paused {a}, so its alert resolved" |
* | "alert_deleted" | "{actor} deleted {a}, so its alert resolved" |
* | "alert_grouped_monitor" | "{a} went down and was grouped here" |
* | "alert_grouped_source" | "The alert {a} fired and was grouped here" |
* | "page_failed_undelivered" | "Couldn't page {a}: the push didn't go through" |
* | "page_failed_unsupported" | "Couldn't page {a}: Brigade can't push to Android phones yet" |
* | "page_failed_not_configured" | "Couldn't page {a}: push notifications aren't set up on this server" |
* | "page_failed_no_devices" | "Couldn't page {a}: no registered device" |
* | "page_failed_token_invalid" | "Couldn't page {a}: Apple refused this phone's token, so it was removed. Opening the Brigade app registers it again" |
* | "page_failed_over_limit" | "Couldn't page {a}: this page went to too many phones" |
* | "page_nobody" | "Nobody was paged: no one who can respond has Brigade on their phone" |
* | "page_dead_lettered" | "A page may not have gone out: Brigade kept failing to send it" |
* | "page_failed_not_a_member" | "Couldn't page {a}: no longer someone who can respond" |
* | "page_nobody_on_call" | "Couldn't page {a}: nobody on call" |
* | "page_schedule_missing" | "Couldn't page a schedule that was deleted" |
* | "escalated_started" | "Paged level {a}: {b}" |
* | "escalated_timeout" | "Nobody acknowledged, so level {a} was paged: {b}" |
* | "escalated_unreachable" | "Earlier levels couldn't reach anyone, so level {a} was paged: {b}" |
* | "escalated_undelivered" | "Nobody on the level before could be reached, so level {a} was paged now: {b}" |
* | "escalated_everyone" | "No level could reach anyone, so everyone who can respond was paged" |
* | "escalated_everyone_later" | "No later level could reach anyone, so everyone who can respond was paged" |
* | "escalated_started_aware" | "Level {a}: {b}" |
* | "escalated_again" | "Level {a} paged again: the earlier page was lost" |
* | "escalated_everyone_again" | "Everyone who can respond paged again: the earlier page was lost" |
* | "paged_again" | "{actor} paged {a} again" |
* | "paged_again_everyone" | "{actor} paged everyone who can respond again" |
* | "paged_again_auto" | "The page was lost, so Brigade paged it again" |
* | "page_nobody_else" | "Nobody else was paged: only the person who declared it can respond" |
* | "escalation_exhausted" | "Nobody acknowledged after every level, so everyone who can respond was paged" |
* | "escalated_everyone_stalled" | "An escalation level kept failing to fire, so everyone who can respond was paged" |
* | "escalated_manual" | "{actor} escalated, so level {a} was paged now: {b}" |
* | "escalated_everyone_manual" | "{actor} escalated past the last level, so everyone who can respond was paged" |
* | "page_escalation_stalled" | "An escalation level couldn't fire. Brigade keeps trying, and pages everyone who can respond if it still can't" |
* | "email_failed_unpaged" | "Couldn't email {a} that the page didn't reach them" |
* | "email_failed_nobody_paged" | "Couldn't email {a} that nobody could be paged" |
* | "email_capped" | "Didn't email {a}: the limit on Brigade's emails was reached" |
* | "slack_failed_no_channel" | "Couldn't post to Slack: the channel is gone, or Brigade isn't in it" |
* | "slack_failed_not_authorized" | "Couldn't post to Slack: Slack refused Brigade's access" |
* | "slack_failed_rate_limited" | "Couldn't post to Slack: Slack kept asking Brigade to slow down" |
* | "slack_failed_undelivered" | "Couldn't post to Slack" |
* | "status_published" | "{actor} published an update to the status page: {a}" |
* | "status_corrected_edited" | "{actor} corrected an update on the status page" |
* | "status_corrected_removed" | "{actor} removed an update from the status page" |
* | "status_corrected_withdrawn" | "{actor} took the incident off the status page" |
* | "type_set" | "{actor} set the type to {a}" |
* | "type_changed" | "{actor} changed the type from {a} to {b}" |
* | "type_cleared" | "{actor} removed the type {a}" |
* | "type_cleared_deleted" | "{actor} removed the type" |
* | "type_changed_deleted" | "{actor} changed the type from a deleted one to {a}" |
* | "services_added" | "{actor} named {a} as affected" |
* | "services_removed" | "{actor} took {a} off the affected services" |
* | "services_changed" | "{actor} named {a} as affected and took off {b}" |
* | "services_updated" | "{actor} changed the affected services" |
* | "field_set" | "{actor} set {a} to {b}" |
* | "field_cleared" | "{actor} cleared {a}" |
* | "follow_up_added" | "{actor} added the follow-up {a}" |
* | "follow_up_edited" | "{actor} edited the follow-up {a}" |
* | "follow_up_done" | "{actor} completed the follow-up {a}" |
* | "follow_up_reopened" | "{actor} reopened the follow-up {a}" |
* | "follow_up_removed" | "{actor} removed the follow-up {a}" |
* | "postmortem_started" | "{actor} started the postmortem" |
* | "postmortem_ai_drafted" | "Workers AI drafted the postmortem" |
* | "alerts_resolved" | "Every alert on this incident resolved. It stays open because people are working on it." |
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
