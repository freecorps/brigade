export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Ack_DoneInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Ack_DoneInputs */
/**
* | output |
* | --- |
* | "Acknowledged." |
*
* @param {Push_Ack_DoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_ack_done: ((inputs?: Push_Ack_DoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_DoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
