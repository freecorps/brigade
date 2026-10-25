export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Name_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Name_LabelInputs */
/**
* | output |
* | --- |
* | "Name" |
*
* @param {Monitor_Name_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_name_label: ((inputs?: Monitor_Name_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Name_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
