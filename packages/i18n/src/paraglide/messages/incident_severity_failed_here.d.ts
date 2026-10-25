export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Severity_Failed_HereInputs = {
    severity: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ severity: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Severity_Failed_HereInputs */
/**
* | output |
* | --- |
* | "Couldn't change it to {severity}. {reason}" |
*
* @param {Incident_Severity_Failed_HereInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_severity_failed_here: ((inputs: Incident_Severity_Failed_HereInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Severity_Failed_HereInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
