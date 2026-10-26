export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Ack_Not_FoundInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Ack_Not_FoundInputs */
/**
* | output |
* | --- |
* | "This incident is no longer in Brigade." |
*
* @param {Push_Ack_Not_FoundInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_ack_not_found: ((inputs?: Push_Ack_Not_FoundInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_Not_FoundInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
