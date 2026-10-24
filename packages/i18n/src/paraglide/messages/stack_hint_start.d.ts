export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Hint_StartInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Hint_StartInputs */
/**
* | output |
* | --- |
* | "Start everything from the repository root, then check again:" |
*
* @param {Stack_Hint_StartInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_hint_start: ((inputs?: Stack_Hint_StartInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Hint_StartInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
