export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Error_NetworkInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Error_NetworkInputs */
/**
* | output |
* | --- |
* | "Couldn't connect to /api." |
*
* @param {Stack_Error_NetworkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_error_network: ((inputs?: Stack_Error_NetworkInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_NetworkInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
