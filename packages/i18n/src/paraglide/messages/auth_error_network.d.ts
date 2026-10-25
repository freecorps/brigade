export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_NetworkInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_NetworkInputs */
/**
* | output |
* | --- |
* | "Could not reach Brigade. Check your connection and try again." |
*
* @param {Auth_Error_NetworkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_network: ((inputs?: Auth_Error_NetworkInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_NetworkInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
