export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Layer_NameInputs = {
    number: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ number: NonNullable<unknown> }} Oncall_Layer_NameInputs */
/**
* | number | output |
* | --- | --- |
* | "1" | "Primary" |
* | * | "Layer {number}" |
*
* @param {Oncall_Layer_NameInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layer_name: ((inputs: Oncall_Layer_NameInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_NameInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
