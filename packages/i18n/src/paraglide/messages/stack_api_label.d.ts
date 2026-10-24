export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Api_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Api_LabelInputs */
/**
* | output |
* | --- |
* | "API Worker" |
*
* @param {Stack_Api_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_api_label: ((inputs?: Stack_Api_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Api_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
