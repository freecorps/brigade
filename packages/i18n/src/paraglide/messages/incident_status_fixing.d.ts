export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Status_FixingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Status_FixingInputs */
/**
* | output |
* | --- |
* | "Fixing" |
*
* @param {Incident_Status_FixingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_status_fixing: ((inputs?: Incident_Status_FixingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Status_FixingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
