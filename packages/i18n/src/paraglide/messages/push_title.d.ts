export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_TitleInputs */
/**
* | output |
* | --- |
* | "Push" |
*
* @param {Push_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_title: ((inputs?: Push_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
