export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_DescriptionInputs */
/**
* | output |
* | --- |
* | "What this JavaScript engine provides on its own, and what the shared helpers render with it." |
*
* @param {Intl_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_description: ((inputs?: Intl_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
