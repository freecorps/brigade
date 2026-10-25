export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Severity_FailedInputs = {
    incident: NonNullable<unknown>;
    severity: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ incident: NonNullable<unknown>, severity: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Severity_FailedInputs */
/**
* | output |
* | --- |
* | "Couldn't change {incident} to {severity}. {reason}" |
*
* @param {Incident_Severity_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_severity_failed: ((inputs: Incident_Severity_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Severity_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
