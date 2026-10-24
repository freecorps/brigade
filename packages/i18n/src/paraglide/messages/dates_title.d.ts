export type LocalizedString = import('../runtime.js').LocalizedString;
export type Dates_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Dates_TitleInputs */
/**
* | output |
* | --- |
* | "Dates and times" |
*
* @param {Dates_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const dates_title: ((inputs?: Dates_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Dates_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
