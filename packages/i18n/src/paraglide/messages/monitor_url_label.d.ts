export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Url_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Url_LabelInputs */
/**
* | output |
* | --- |
* | "URL" |
*
* @param {Monitor_Url_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_url_label: ((inputs?: Monitor_Url_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Url_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
