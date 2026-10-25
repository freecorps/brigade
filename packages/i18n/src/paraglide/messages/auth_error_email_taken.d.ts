export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_Email_TakenInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_Email_TakenInputs */
/**
* | output |
* | --- |
* | "An account with this email already exists. Sign in instead." |
*
* @param {Auth_Error_Email_TakenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_email_taken: ((inputs?: Auth_Error_Email_TakenInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Email_TakenInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
