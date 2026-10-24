export type LocalizedString = import('../runtime.js').LocalizedString;
export type Mobile_Overview_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Mobile_Overview_DescriptionInputs */
/**
* | output |
* | --- |
* | "The severity and status legend, drawn from the shared tokens and catalog." |
*
* @param {Mobile_Overview_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const mobile_overview_description: ((inputs?: Mobile_Overview_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Overview_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
