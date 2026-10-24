export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_LatencyInputs = {
    ms: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ ms: NonNullable<unknown> }} Stack_LatencyInputs */
/**
* | output |
* | --- |
* | "{ms} ms round trip" |
*
* @param {Stack_LatencyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_latency: ((inputs: Stack_LatencyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_LatencyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
