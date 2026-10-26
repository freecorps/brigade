export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Change_FailedInputs = {
    name: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown>, reason: NonNullable<unknown> }} Escalation_Change_FailedInputs */
/**
* | output |
* | --- |
* | "Couldn't change {name}: {reason}" |
*
* @param {Escalation_Change_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_change_failed: ((inputs: Escalation_Change_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Change_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
