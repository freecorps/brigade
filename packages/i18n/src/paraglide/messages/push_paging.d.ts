export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_PagingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_PagingInputs */
/**
* | output |
* | --- |
* | "Paging" |
*
* @param {Push_PagingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_paging: ((inputs?: Push_PagingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_PagingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
