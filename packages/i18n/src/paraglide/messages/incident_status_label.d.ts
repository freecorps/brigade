export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Status_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Status_LabelInputs */
/**
* | output |
* | --- |
* | "Status" |
*
* @param {Incident_Status_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_status_label: ((inputs?: Incident_Status_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Status_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
