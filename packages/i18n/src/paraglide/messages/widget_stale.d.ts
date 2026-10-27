export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_StaleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_StaleInputs */
/**
* | output |
* | --- |
* | "Open Brigade to update" |
*
* @param {Widget_StaleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_stale: ((inputs?: Widget_StaleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_StaleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
