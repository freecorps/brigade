export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_TextInputs = {
    part: NonNullable<unknown>;
    incident: NonNullable<unknown>;
    title: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
    reason: NonNullable<unknown>;
    url: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, incident: NonNullable<unknown>, title: NonNullable<unknown>, workspace: NonNullable<unknown>, reason: NonNullable<unknown>, url: NonNullable<unknown> }} Email_TextInputs */
/**
* | part | output |
* | --- | --- |
* | "unpaged_subject" | "{incident}: {title} (Brigade couldn't page you)" |
* | "unpaged_intro" | "Brigade tried to page you about {incident} in {workspace}, but the page didn't reach your phone: {reason}." |
* | "unpaged_reason_no_devices" | "you have no phone registered with Brigade" |
* | "unpaged_reason_undelivered" | "the push notification didn't go through" |
* | "unpaged_reason_unsupported" | "Brigade can't send pages to Android phones yet" |
* | "unpaged_reason_not_configured" | "push notifications aren't set up on this Brigade server" |
* | "unpaged_reason_over_limit" | "the page went to more phones than one page can reach" |
* | "unpaged_hint" | "To get pages on your phone, install the Brigade app, sign in and allow notifications." |
* | "unpaged_footer" | "You're getting this email because you can respond to incidents in {workspace}." |
* | "nobody_subject" | "Nobody could be paged for {incident}: {title}" |
* | "nobody_intro" | "Nobody could be paged for {incident} in {workspace}. Brigade tried everyone it could and the page reached no one's phone, and nobody has acknowledged the inc..." |
* | "nobody_timeline" | "The incident's timeline says why each page failed." |
* | "nobody_footer" | "You're getting this email because you're an owner of {workspace}." |
* | "fact_incident" | "Incident: {incident}" |
* | "fact_title" | "Title: {title}" |
* | "open" | "Open the incident" |
* | * | "Brigade" |
*
* @param {Email_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_text: ((inputs: Email_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
