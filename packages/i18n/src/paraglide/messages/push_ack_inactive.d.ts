export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Ack_InactiveInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Ack_InactiveInputs */
/**
* | output |
* | --- |
* | "This incident is no longer active, so there is nothing to acknowledge." |
*
* @param {Push_Ack_InactiveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_ack_inactive: ((inputs?: Push_Ack_InactiveInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_InactiveInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
