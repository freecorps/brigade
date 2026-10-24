export type LocalizedString = import('../runtime.js').LocalizedString;
export type Skip_To_ContentInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Skip_To_ContentInputs */
/**
* | output |
* | --- |
* | "Skip to content" |
*
* @param {Skip_To_ContentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const skip_to_content: ((inputs?: Skip_To_ContentInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Skip_To_ContentInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
