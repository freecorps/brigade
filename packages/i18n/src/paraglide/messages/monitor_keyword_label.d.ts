export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Keyword_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Keyword_LabelInputs */
/**
* | output |
* | --- |
* | "Text the page must contain" |
*
* @param {Monitor_Keyword_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_keyword_label: ((inputs?: Monitor_Keyword_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Keyword_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
