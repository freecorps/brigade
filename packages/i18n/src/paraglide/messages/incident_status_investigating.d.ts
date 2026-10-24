export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Status_InvestigatingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Status_InvestigatingInputs */
/**
* | output |
* | --- |
* | "Investigating" |
*
* @param {Incident_Status_InvestigatingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_status_investigating: ((inputs?: Incident_Status_InvestigatingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Status_InvestigatingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
