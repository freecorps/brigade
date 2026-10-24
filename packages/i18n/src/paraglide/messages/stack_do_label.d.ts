export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Do_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Do_LabelInputs */
/**
* | output |
* | --- |
* | "Durable Object" |
*
* @param {Stack_Do_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_do_label: ((inputs?: Stack_Do_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Do_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
