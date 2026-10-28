export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_Email_Not_VerifiedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_Email_Not_VerifiedInputs */
/**
* | output |
* | --- |
* | "Confirm your email first: open the link Brigade sent you, then sign in. Lost the link? Reset your password, which confirms your email too." |
*
* @param {Auth_Error_Email_Not_VerifiedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_email_not_verified: ((inputs?: Auth_Error_Email_Not_VerifiedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Email_Not_VerifiedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
