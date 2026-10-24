export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Api_StuckInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Api_StuckInputs */
/**
* | output |
* | --- |
* | "The API Worker is not answering in time" |
*
* @param {Stack_Api_StuckInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_api_stuck: ((inputs?: Stack_Api_StuckInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Api_StuckInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
