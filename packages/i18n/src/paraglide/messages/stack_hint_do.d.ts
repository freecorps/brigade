export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Hint_DoInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Hint_DoInputs */
/**
* | output |
* | --- |
* | "The API is up, so the error is in the terminal running:" |
*
* @param {Stack_Hint_DoInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_hint_do: ((inputs?: Stack_Hint_DoInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Hint_DoInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
