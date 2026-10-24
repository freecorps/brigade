export type LocalizedString = import('../runtime.js').LocalizedString;
export type Overview_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Overview_TitleInputs */
/**
* | output |
* | --- |
* | "Overview" |
*
* @param {Overview_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const overview_title: ((inputs?: Overview_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Overview_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
