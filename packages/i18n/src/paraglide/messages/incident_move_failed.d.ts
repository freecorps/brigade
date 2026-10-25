export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Move_FailedInputs = {
    incident: NonNullable<unknown>;
    status: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ incident: NonNullable<unknown>, status: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Move_FailedInputs */
/**
* | output |
* | --- |
* | "Couldn't move {incident} to {status}. {reason}" |
*
* @param {Incident_Move_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_move_failed: ((inputs: Incident_Move_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Move_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
