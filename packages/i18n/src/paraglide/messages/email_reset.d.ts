export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_ResetInputs = {
    part: NonNullable<unknown>;
    email: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Email_ResetInputs */
/**
* | part | output |
* | --- | --- |
* | "subject" | "Reset your Brigade password" |
* | "intro" | "Someone asked to reset the password of the Brigade account for {email}. If it was you, choose a new password with this link." |
* | "open" | "Choose a new password" |
* | "expires" | "The link works once, for 1 hour. Setting a new password signs the account out everywhere, including phones, and confirms this email address." |
* | "footer" | "If you didn't ask for this, ignore this email: your password stays as it is." |
* | * | "Brigade" |
*
* @param {Email_ResetInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_reset: ((inputs: Email_ResetInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_ResetInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
