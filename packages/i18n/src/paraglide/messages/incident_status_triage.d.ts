export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Status_TriageInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Status_TriageInputs */
/**
* | output |
* | --- |
* | "Triage" |
*
* @param {Incident_Status_TriageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_status_triage: ((inputs?: Incident_Status_TriageInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Status_TriageInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
