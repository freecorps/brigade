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
* | "why_title" | "Why wasn't {name} paged?" |
* | "why_title_you" | "Why wasn't I paged?" |
* | "why_link" | "Why?" |
* | "explain" | "Explain step by step" |
* | "back" | "Back to {name}" |
* | "pick_member" | "Member" |
* | "loading" | "Loading delivery details…" |
* | "empty" | "No page has gone out for this incident yet." |
* | "privacy" | "Only members of this workspace see when a phone received a page." |
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
* | "short_missed" | "Not paged" |
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
* | "stage_sent" | "Handed to the relay" |
* | "stage_accepted" | "Accepted by Apple" |
* | "stage_delivered" | "Opened on the phone" |
* | "no_receipt" | "No receipt from the phone. Receipts are best effort: the page may still have shown." |
* | "attempts" | "Attempts: {detail}" |
* | "error_not_configured" | "Push notifications aren't set up on this server" |
* | "error_unsupported" | "Brigade can't push to Android phones yet" |
* | "error_seal_failed" | "The page couldn't be encrypted for this phone" |
* | "error_relay_unreachable" | "The push relay didn't answer" |
* | "error_relay_refused" | "The push relay refused the request" |
* | "error_token_invalid" | "Apple said this phone's token is no longer valid, so the phone was removed" |
* | "error_apns_refused" | "Apple refused the push" |
* | "error_apns_unavailable" | "Apple was busy or failing" |
* | "apns_reason" | "Apple said: {detail}" |
* | "email_expected" | "Brigade emails {name} once about a page that missed them." |
* | "email_failed" | "Couldn't email {name} about the missed page." |
* | "email_capped" | "Not emailed: the limit on Brigade's emails was reached." |
* | "email_off" | "Emails about missed pages are off in this workspace." |
* | "acknowledged" | "{name} acknowledged it {time}, which stopped paging." |
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
