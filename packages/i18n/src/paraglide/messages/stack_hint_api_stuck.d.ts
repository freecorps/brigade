export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Hint_Api_StuckInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Hint_Api_StuckInputs */
/**
* | output |
* | --- |
* | "The API looks like it is running but stuck. Look in the terminal running:" |
*
* @param {Stack_Hint_Api_StuckInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_hint_api_stuck: ((inputs?: Stack_Hint_Api_StuckInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Hint_Api_StuckInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
