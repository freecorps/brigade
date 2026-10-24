export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_UnreachableInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_UnreachableInputs */
/**
* | output |
* | --- |
* | "Unreachable" |
*
* @param {Stack_UnreachableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_unreachable: ((inputs?: Stack_UnreachableInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_UnreachableInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
