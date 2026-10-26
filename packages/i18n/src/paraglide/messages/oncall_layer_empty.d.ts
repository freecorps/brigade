export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Layer_EmptyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Layer_EmptyInputs */
/**
* | output |
* | --- |
* | "Nobody in this layer: a gap until someone is added" |
*
* @param {Oncall_Layer_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layer_empty: ((inputs?: Oncall_Layer_EmptyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_EmptyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
