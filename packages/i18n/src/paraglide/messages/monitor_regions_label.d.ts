export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Regions_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Regions_LabelInputs */
/**
* | output |
* | --- |
* | "Check from" |
*
* @param {Monitor_Regions_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_regions_label: ((inputs?: Monitor_Regions_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Regions_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
