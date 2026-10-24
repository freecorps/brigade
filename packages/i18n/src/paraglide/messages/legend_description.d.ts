export type LocalizedString = import('../runtime.js').LocalizedString;
export type Legend_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Legend_DescriptionInputs */
/**
* | output |
* | --- |
* | "How incidents are marked across Brigade. The code or the name always travels with the colour." |
*
* @param {Legend_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const legend_description: ((inputs?: Legend_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Legend_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
