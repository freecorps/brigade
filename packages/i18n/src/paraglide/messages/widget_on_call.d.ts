export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_On_CallInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_On_CallInputs */
/**
* | output |
* | --- |
* | "On call" |
*
* @param {Widget_On_CallInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_on_call: ((inputs?: Widget_On_CallInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_On_CallInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
