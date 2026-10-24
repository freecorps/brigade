export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Timed_OutInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Timed_OutInputs */
/**
* | output |
* | --- |
* | "Timed out" |
*
* @param {Stack_Timed_OutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_timed_out: ((inputs?: Stack_Timed_OutInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Timed_OutInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
