export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Gaps_LayersInputs = {
    layers: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ layers: NonNullable<unknown> }} Oncall_Gaps_LayersInputs */
/**
* | output |
* | --- |
* | "Nobody in {layers}" |
*
* @param {Oncall_Gaps_LayersInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_gaps_layers: ((inputs: Oncall_Gaps_LayersInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Gaps_LayersInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
