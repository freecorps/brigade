export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Layer_AddInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Layer_AddInputs */
/**
* | output |
* | --- |
* | "Add layer" |
*
* @param {Oncall_Layer_AddInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layer_add: ((inputs?: Oncall_Layer_AddInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_AddInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
