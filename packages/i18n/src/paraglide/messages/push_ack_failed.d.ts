export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Ack_FailedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Ack_FailedInputs */
/**
* | output |
* | --- |
* | "Couldn't acknowledge: Brigade can't be reached. Tap Acknowledge to try again." |
*
* @param {Push_Ack_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_ack_failed: ((inputs?: Push_Ack_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
