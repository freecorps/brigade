export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_ErroringInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_ErroringInputs */
/**
* | output |
* | --- |
* | "Erroring" |
*
* @param {Stack_ErroringInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_erroring: ((inputs?: Stack_ErroringInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_ErroringInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
