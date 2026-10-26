export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_DegradedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_DegradedInputs */
/**
* | output |
* | --- |
* | "Pages may not reach phones" |
*
* @param {Paging_DegradedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_degraded: ((inputs?: Paging_DegradedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_DegradedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
