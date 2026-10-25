export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_No_IncidentInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_No_IncidentInputs */
/**
* | output |
* | --- |
* | "This page names no incident, so it can't be acknowledged here." |
*
* @param {Call_No_IncidentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_no_incident: ((inputs?: Call_No_IncidentInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_No_IncidentInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
