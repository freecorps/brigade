export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Hint_Api_ErrorInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Hint_Api_ErrorInputs */
/**
* | output |
* | --- |
* | "The API answered with an error. Look for it in the terminal running:" |
*
* @param {Stack_Hint_Api_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_hint_api_error: ((inputs?: Stack_Hint_Api_ErrorInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Hint_Api_ErrorInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
