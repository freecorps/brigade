export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_DescriptionInputs */
/**
* | output |
* | --- |
* | "Whether you're on call, until when, and your next shift." |
*
* @param {Widget_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_description: ((inputs?: Widget_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
