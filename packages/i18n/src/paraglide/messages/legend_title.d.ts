export type LocalizedString = import('../runtime.js').LocalizedString;
export type Legend_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Legend_TitleInputs */
/**
* | output |
* | --- |
* | "Severity and status" |
*
* @param {Legend_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const legend_title: ((inputs?: Legend_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Legend_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
