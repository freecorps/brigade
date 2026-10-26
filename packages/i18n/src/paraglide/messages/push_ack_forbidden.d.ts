export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Ack_ForbiddenInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Ack_ForbiddenInputs */
/**
* | output |
* | --- |
* | "You can no longer acknowledge incidents in this workspace." |
*
* @param {Push_Ack_ForbiddenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_ack_forbidden: ((inputs?: Push_Ack_ForbiddenInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_ForbiddenInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
