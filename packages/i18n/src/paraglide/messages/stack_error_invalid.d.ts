export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Error_InvalidInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Error_InvalidInputs */
/**
* | output |
* | --- |
* | "The API answered, but not with the data the dashboard expects." |
*
* @param {Stack_Error_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_error_invalid: ((inputs?: Stack_Error_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
