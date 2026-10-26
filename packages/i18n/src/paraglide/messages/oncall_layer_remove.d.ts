export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Layer_RemoveInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Layer_RemoveInputs */
/**
* | output |
* | --- |
* | "Remove layer {name}" |
*
* @param {Oncall_Layer_RemoveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layer_remove: ((inputs: Oncall_Layer_RemoveInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_RemoveInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
