export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Status_DeclinedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Status_DeclinedInputs */
/**
* | output |
* | --- |
* | "Declined" |
*
* @param {Incident_Status_DeclinedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_status_declined: ((inputs?: Incident_Status_DeclinedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Status_DeclinedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
