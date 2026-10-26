export type LocalizedString = import('../runtime.js').LocalizedString;
export type Verify_PageInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Verify_PageInputs */
/**
* | part | output |
* | --- | --- |
* | "page_title" | "Confirm email" |
* | "checking" | "Confirming your email…" |
* | "done_title" | "Email confirmed" |
* | "done_body" | "Brigade can now email you, and you can invite people and accept invitations." |
* | "expired_title" | "This link has expired" |
* | "expired_body" | "Links work for 24 hours. Sign in and ask for a new one." |
* | "invalid_title" | "This link doesn't work" |
* | "invalid_body" | "It may have been cut off when you opened it. Sign in and ask for a new one." |
* | "failed_body" | "Couldn't reach Brigade. Check your connection and try again." |
* | "retry" | "Try again" |
* | "continue" | "Continue" |
* | * | "Confirm email" |
*
* @param {Verify_PageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const verify_page: ((inputs: Verify_PageInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Verify_PageInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
