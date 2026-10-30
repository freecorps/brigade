export type LocalizedString = import('../runtime.js').LocalizedString;
export type Page_WhyInputs = {
    text: NonNullable<unknown>;
    name: NonNullable<unknown>;
    time: NonNullable<unknown>;
    detail: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, detail: NonNullable<unknown> }} Page_WhyInputs */
/**
* | text | output |
* | --- | --- |
* | "title" | "Who was paged" |
* | "why_title" | "Paging for {name}" |
* | "why_title_you" | "My paging" |
* | "why_link" | "Why?" |
* | "explain" | "Explain step by step" |
* | "back" | "Back to {name}" |
* | "pick_member" | "Member" |
* | "loading" | "Loading delivery details…" |
* | "empty" | "No page has gone out for this incident yet." |
* | "privacy" | "Everyone in this workspace sees each member's phones, when Brigade last heard from them, and when a phone received a page." |
* | "verdict_delivered" | "The page reached {name}'s phone" |
* | "verdict_accepted" | "Sent to {name}'s phone, but the phone hasn't confirmed it" |
* | "verdict_sending" | "A page is on its way to {name}" |
* | "verdict_failed" | "No page got through to {name}'s phone" |
* | "verdict_missed" | "Brigade couldn't page {name}" |
* | "verdict_declarer" | "{name} declared it, so Brigade didn't page them" |
* | "verdict_excluded" | "{name} can't be paged" |
* | "verdict_not_targeted" | "The pages went to others, not {name}" |
* | "verdict_none" | "Nothing has paged yet" |
* | "short_delivered" | "Delivered" |
* | "short_accepted" | "Sent, no receipt" |
* | "short_sending" | "Sending" |
* | "short_failed" | "Failed" |
* | "short_missed" | "Couldn't page" |
* | "short_declarer" | "Declared it" |
* | "short_excluded" | "Can't be paged" |
* | "short_not_targeted" | "Not paged" |
* | "short_none" | "Not paged yet" |
* | "step_responder" | "{name} can respond, so pages can reach them." |
* | "step_viewer" | "{name} is a viewer. Viewers only read and are never paged." |
* | "step_gone" | "{name} is no longer in this workspace." |
* | "rule_policy" | "Pages follow the escalation policy {detail}." |
* | "rule_interim" | "No escalation policy: pages go to the commander, or to everyone who can respond." |
* | "page_level" | "Level {detail}" |
* | "page_round" | "Round {detail}" |
* | "page_everyone" | "Everyone who can respond" |
* | "page_interim" | "Page" |
* | "page_again" | "Paged again" |
* | "targeted_paged" | "This page was for {name}." |
* | "targeted_declarer" | "{name} declared it: counted as reached, not pushed." |
* | "targeted_not_on_call" | "{name} wasn't on call for {detail}." |
* | "targeted_not_on_call_plain" | "{name} wasn't on call." |
* | "targeted_instead" | "Paged instead: {detail}." |
* | "targeted_not_in_level" | "This level doesn't include {name}." |
* | "targeted_excluded" | "{name} couldn't respond then (a viewer, or not a member)." |
* | "targeted_commander_only" | "The commander was paged first, not {name}." |
* | "devices_none" | "No phone registered. Signing in on the Brigade app registers one." |
* | "devices_title" | "Phones registered now" |
* | "platform_ios" | "iPhone" |
* | "platform_android" | "Android" |
* | "env_production" | "App Store build" |
* | "env_sandbox" | "Development build" |
* | "seen" | "Last heard from {time}" |
* | "calls" | "Takes calls" |
* | "stage_planned" | "Planned" |
* | "stage_sent" | "Sent by Brigade" |
* | "stage_accepted" | "Accepted by Apple or Google" |
* | "stage_delivered" | "Opened on the phone" |
* | "no_receipt" | "No receipt from the phone. Receipts are best effort: the page may still have shown." |
* | "attempts" | "Attempts: {detail}" |
* | "error_not_configured" | "Push notifications aren't set up on this server" |
* | "error_unsupported" | "Brigade couldn't push to Android phones then" |
* | "error_seal_failed" | "The page couldn't be encrypted for this phone" |
* | "error_relay_unreachable" | "Brigade's sending service didn't answer" |
* | "error_relay_refused" | "Brigade's sending service refused the request" |
* | "error_token_invalid" | "Apple or Google said this phone's token is no longer valid, so the phone was removed" |
* | "error_apns_refused" | "Apple or Google refused the push" |
* | "error_apns_unavailable" | "Apple or Google was busy or failing" |
* | "apns_reason" | "Apple or Google said: {detail}" |
* | "email_expected" | "Brigade will email {name} once about a page that missed them." |
* | "email_failed" | "Couldn't email {name} about the missed page." |
* | "email_capped" | "Not emailed: the limit on Brigade's emails was reached." |
* | "email_off" | "Emails about missed pages are off in this workspace." |
* | "acknowledged" | "{name} acknowledged it {time}, which stopped paging." |
* | "why_link_label" | "Was {name} paged?" |
* | "open_hint" | "Opens the step-by-step explanation" |
* | "verdict_missed_reason" | "Brigade couldn't page {name}: {detail}" |
* | "verdict_stuck" | "A page to {name} was planned but never sent" |
* | "short_stuck" | "Planned but never sent" |
* | "stage_none" | "Not reached" |
* | "stage_stopped" | "Stopped here" |
* | "stuck_note" | "Brigade planned this page but never sent it. Pages go out within seconds, so it's stuck." |
* | "pages_same" | "Same outcome as {detail} earlier pages to this level" |
* | "pages_same_one" | "Same outcome as the earlier page to this level" |
* | "pages_show_all" | "Show all {detail} pages" |
* | "miss_no_devices" | "no phone registered" |
* | "miss_undelivered" | "the page didn't go through" |
* | "miss_token_invalid" | "Apple or Google refused this phone's token, so it was removed. Opening the Brigade app registers it again" |
* | "miss_unsupported" | "Brigade couldn't page Android phones then" |
* | "miss_not_configured" | "notifications aren't set up on this server" |
* | "miss_over_limit" | "the page went to too many phones" |
* | "miss_dead_lettered" | "the page was lost on the way" |
* | "miss_nobody_on_call" | "nobody was on call" |
* | "miss_schedule_missing" | "the level's schedule was deleted" |
* | "miss_not_a_member" | "they can no longer respond" |
* | "miss_escalation_stalled" | "the escalation stalled" |
* | "miss_nobody_else" | "nobody else could respond" |
* | "call_label" | "Call · {detail}" |
* | "call_not_sent" | "Not rung: Brigade rings a phone only after the page's notification gets through to Apple or Google." |
* | "call_error_token_invalid" | "Apple or Google said this phone's call token is no longer valid, so Brigade stopped calling it. Pages still reach it as notifications." |
* | "call_note" | "Calls ring after the notification and never change whether the page got through." |
* | "short_call_accepted" | "Call sent" |
* | "short_call_sending" | "Calling" |
* | "short_call_failed" | "Call failed" |
* | "short_call_not_sent" | "Call not sent" |
* | "calls_choice_sev1_sev2" | "{name}'s phones ring as a call for SEV1 pages and SEV2 escalations" |
* | "calls_choice_sev1" | "{name}'s phones ring as a call for SEV1 pages only" |
* | "calls_choice_never" | "{name} turned calls off: pages come as notifications only" |
* | * | "Who was paged" |
*
* @param {Page_WhyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const page_why: ((inputs: Page_WhyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_WhyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
