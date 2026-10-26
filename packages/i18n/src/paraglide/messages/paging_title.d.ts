export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_TitleInputs */
/**
* | output |
* | --- |
* | "Paging self-check" |
*
* @param {Paging_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_title: ((inputs?: Paging_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
