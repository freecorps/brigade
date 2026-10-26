export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Ack_Signed_OutInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Ack_Signed_OutInputs */
/**
* | output |
* | --- |
* | "Couldn't acknowledge: sign in to Brigade first." |
*
* @param {Push_Ack_Signed_OutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_ack_signed_out: ((inputs?: Push_Ack_Signed_OutInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_Signed_OutInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
