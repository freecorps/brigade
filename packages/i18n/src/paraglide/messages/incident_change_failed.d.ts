export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Change_FailedInputs = {
    kind: NonNullable<unknown>;
    role: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, role: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Change_FailedInputs */
/**
* | kind | output |
* | --- | --- |
* | "update" | "Couldn't post the update. {reason}" |
* | * | "Couldn't change the {role}. {reason}" |
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
