export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Api_ErrorInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Api_ErrorInputs */
/**
* | output |
* | --- |
* | "The API Worker is answering with errors" |
*
* @param {Stack_Api_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_api_error: ((inputs?: Stack_Api_ErrorInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Api_ErrorInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
