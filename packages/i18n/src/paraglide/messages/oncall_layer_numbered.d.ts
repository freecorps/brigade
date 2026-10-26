export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Layer_NumberedInputs = {
    number: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ number: NonNullable<unknown> }} Oncall_Layer_NumberedInputs */
/**
* | output |
* | --- |
* | "Layer {number}" |
*
* @param {Oncall_Layer_NumberedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layer_numbered: ((inputs: Oncall_Layer_NumberedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_NumberedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
