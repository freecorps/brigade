export type LocalizedString = import('../runtime.js').LocalizedString;
export type Overview_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Overview_DescriptionInputs */
/**
* | output |
* | --- |
* | "The dashboard, its Worker, the API Worker and a Durable Object, all running on your machine." |
*
* @param {Overview_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const overview_description: ((inputs?: Overview_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Overview_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
