export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Error_UnreachableInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Error_UnreachableInputs */
/**
* | output |
* | --- |
* | "The web Worker couldn't reach the API Worker." |
*
* @param {Stack_Error_UnreachableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_error_unreachable: ((inputs?: Stack_Error_UnreachableInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_UnreachableInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
