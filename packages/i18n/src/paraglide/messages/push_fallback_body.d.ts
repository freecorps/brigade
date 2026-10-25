export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Fallback_BodyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Fallback_BodyInputs */
/**
* | output |
* | --- |
* | "Open Brigade to see it." |
*
* @param {Push_Fallback_BodyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_fallback_body: ((inputs?: Push_Fallback_BodyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Fallback_BodyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
