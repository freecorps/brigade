export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Layers_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Layers_HintInputs */
/**
* | output |
* | --- |
* | "Layers stack: a later layer wins where it has someone on call. Handoffs follow the time zone's clock, also across daylight saving changes." |
*
* @param {Oncall_Layers_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_layers_hint: ((inputs?: Oncall_Layers_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layers_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
