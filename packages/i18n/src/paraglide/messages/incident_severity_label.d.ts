export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Severity_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Severity_LabelInputs */
/**
* | output |
* | --- |
* | "Severity" |
*
* @param {Incident_Severity_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_severity_label: ((inputs?: Incident_Severity_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Severity_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
