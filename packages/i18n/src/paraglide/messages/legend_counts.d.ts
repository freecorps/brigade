export type LocalizedString = import('../runtime.js').LocalizedString;
export type Legend_CountsInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Legend_CountsInputs */
/**
* | output |
* | --- |
* | "Active incident count" |
*
* @param {Legend_CountsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const legend_counts: ((inputs?: Legend_CountsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Legend_CountsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
