export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Layer_DefaultInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Layer_DefaultInputs */
/**
* | output |
* | --- |
* | "Primary" |
*
* @param {Oncall_Layer_DefaultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layer_default: ((inputs?: Oncall_Layer_DefaultInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_DefaultInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
