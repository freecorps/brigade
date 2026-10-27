export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_Signed_OutInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_Signed_OutInputs */
/**
* | output |
* | --- |
* | "Sign in to Brigade" |
*
* @param {Widget_Signed_OutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_signed_out: ((inputs?: Widget_Signed_OutInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_Signed_OutInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
