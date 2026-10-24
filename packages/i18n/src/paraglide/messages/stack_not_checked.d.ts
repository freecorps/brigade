export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Not_CheckedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Not_CheckedInputs */
/**
* | output |
* | --- |
* | "Not checked" |
*
* @param {Stack_Not_CheckedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_not_checked: ((inputs?: Stack_Not_CheckedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Not_CheckedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
