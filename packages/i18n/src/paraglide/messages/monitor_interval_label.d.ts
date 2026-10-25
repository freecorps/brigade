export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Interval_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Interval_LabelInputs */
/**
* | output |
* | --- |
* | "Every (seconds)" |
*
* @param {Monitor_Interval_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_interval_label: ((inputs?: Monitor_Interval_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Interval_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
