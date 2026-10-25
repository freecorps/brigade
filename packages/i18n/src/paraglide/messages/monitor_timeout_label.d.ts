export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Timeout_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Timeout_LabelInputs */
/**
* | output |
* | --- |
* | "Timeout (seconds)" |
*
* @param {Monitor_Timeout_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_timeout_label: ((inputs?: Monitor_Timeout_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Timeout_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
