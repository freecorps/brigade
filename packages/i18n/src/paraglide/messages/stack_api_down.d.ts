export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Api_DownInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Api_DownInputs */
/**
* | output |
* | --- |
* | "The API Worker is not responding" |
*
* @param {Stack_Api_DownInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_api_down: ((inputs?: Stack_Api_DownInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Api_DownInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
