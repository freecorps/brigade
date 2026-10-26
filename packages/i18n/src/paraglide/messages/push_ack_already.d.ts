export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Ack_AlreadyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Ack_AlreadyInputs */
/**
* | output |
* | --- |
* | "Already acknowledged." |
*
* @param {Push_Ack_AlreadyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_ack_already: ((inputs?: Push_Ack_AlreadyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_AlreadyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
