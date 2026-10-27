export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_Off_CallInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_Off_CallInputs */
/**
* | output |
* | --- |
* | "Not on call" |
*
* @param {Widget_Off_CallInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_off_call: ((inputs?: Widget_Off_CallInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_Off_CallInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
