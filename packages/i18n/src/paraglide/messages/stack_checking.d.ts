export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_CheckingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_CheckingInputs */
/**
* | output |
* | --- |
* | "Checking the local stack…" |
*
* @param {Stack_CheckingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_checking: ((inputs?: Stack_CheckingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_CheckingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
