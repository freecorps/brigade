export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Fallback_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Fallback_TitleInputs */
/**
* | output |
* | --- |
* | "New alert" |
*
* @param {Push_Fallback_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_fallback_title: ((inputs?: Push_Fallback_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Fallback_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
