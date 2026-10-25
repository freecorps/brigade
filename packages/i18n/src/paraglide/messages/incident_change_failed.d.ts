export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Change_FailedInputs = {
    incident: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ incident: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Change_FailedInputs */
/**
* | output |
* | --- |
* | "Couldn't update {incident}. {reason}" |
*
* @param {Incident_Change_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_change_failed: ((inputs: Incident_Change_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Change_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
