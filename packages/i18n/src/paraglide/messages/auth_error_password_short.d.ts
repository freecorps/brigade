export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_Password_ShortInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_Password_ShortInputs */
/**
* | output |
* | --- |
* | "Use at least 8 characters." |
*
* @param {Auth_Error_Password_ShortInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_password_short: ((inputs?: Auth_Error_Password_ShortInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Password_ShortInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
