export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Test_No_IncidentInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Test_No_IncidentInputs */
/**
* | output |
* | --- |
* | "Declare an incident first: the call acknowledges it." |
*
* @param {Call_Test_No_IncidentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_test_no_incident: ((inputs?: Call_Test_No_IncidentInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Test_No_IncidentInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
