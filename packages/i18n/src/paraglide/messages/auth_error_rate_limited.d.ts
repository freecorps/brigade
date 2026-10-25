export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_Rate_LimitedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_Rate_LimitedInputs */
/**
* | output |
* | --- |
* | "Too many attempts. Wait a minute and try again." |
*
* @param {Auth_Error_Rate_LimitedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_rate_limited: ((inputs?: Auth_Error_Rate_LimitedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Rate_LimitedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
