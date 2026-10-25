export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Expected_Status_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Expected_Status_LabelInputs */
/**
* | output |
* | --- |
* | "Expected status" |
*
* @param {Monitor_Expected_Status_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_expected_status_label: ((inputs?: Monitor_Expected_Status_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Expected_Status_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
