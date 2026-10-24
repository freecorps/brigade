export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Needs_ApiInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Needs_ApiInputs */
/**
* | output |
* | --- |
* | "Needs the API Worker." |
*
* @param {Stack_Needs_ApiInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_needs_api: ((inputs?: Stack_Needs_ApiInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Needs_ApiInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
