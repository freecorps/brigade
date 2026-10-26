export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_LayersInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_LayersInputs */
/**
* | output |
* | --- |
* | "Layers" |
*
* @param {Oncall_LayersInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layers: ((inputs?: Oncall_LayersInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_LayersInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
