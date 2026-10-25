export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Ack_FailedInputs = {
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown> }} Call_Ack_FailedInputs */
/**
* | output |
* | --- |
* | "Couldn't acknowledge. {reason}" |
*
* @param {Call_Ack_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_ack_failed: ((inputs: Call_Ack_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Ack_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
