export type LocalizedString = import('../runtime.js').LocalizedString;
export type Verify_NoticeInputs = {
    part: NonNullable<unknown>;
    email: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Verify_NoticeInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Confirm your email" |
* | "body" | "We sent a link to {email}. Until you open it, Brigade won't email you, and you can't invite people or accept invitations." |
* | "resend" | "Send the link again" |
* | "sending" | "Sending…" |
* | "sent" | "Sent. Open the newest email from Brigade (check spam too)." |
* | "rate_limited" | "You asked for several links just now. Wait a few minutes and try again." |
* | "not_configured" | "This Brigade server can't send email yet. Ask whoever runs it." |
* | "failed" | "Couldn't send the link. Try again." |
* | * | "Confirm your email" |
*
* @param {Verify_NoticeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const verify_notice: ((inputs: Verify_NoticeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Verify_NoticeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
