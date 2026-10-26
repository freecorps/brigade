export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_VerifyInputs = {
    part: NonNullable<unknown>;
    email: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Email_VerifyInputs */
/**
* | part | output |
* | --- | --- |
* | "subject" | "Confirm your email for Brigade" |
* | "intro" | "Confirm that {email} is your address. Until you do, Brigade won't email you about incidents, and you can't invite people or accept invitations." |
* | "open" | "Confirm my email" |
* | "expires" | "The link works for 24 hours." |
* | "footer" | "If you didn't create a Brigade account, ignore this email: nothing happens without the link." |
* | * | "Brigade" |
*
* @param {Email_VerifyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_verify: ((inputs: Email_VerifyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_VerifyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
