export type LocalizedString = import('../runtime.js').LocalizedString;
export type Language_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Language_LabelInputs */
/**
* | output |
* | --- |
* | "Language" |
*
* @param {Language_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const language_label: ((inputs?: Language_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Language_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
