export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Ack_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Ack_HintInputs */
/**
* | output |
* | --- |
* | "Or press 1 on the keypad." |
*
* @param {Call_Ack_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_ack_hint: ((inputs?: Call_Ack_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Ack_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
