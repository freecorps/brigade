export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_NameInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_NameInputs */
/**
* | output |
* | --- |
* | "On call" |
*
* @param {Widget_NameInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_name: ((inputs?: Widget_NameInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_NameInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
