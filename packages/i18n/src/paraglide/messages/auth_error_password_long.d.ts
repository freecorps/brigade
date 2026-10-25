export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_Password_LongInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_Password_LongInputs */
/**
* | output |
* | --- |
* | "Use at most 128 characters." |
*
* @param {Auth_Error_Password_LongInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_password_long: ((inputs?: Auth_Error_Password_LongInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Password_LongInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
