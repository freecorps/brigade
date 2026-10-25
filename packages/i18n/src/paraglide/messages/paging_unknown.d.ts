export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_UnknownInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_UnknownInputs */
/**
* | output |
* | --- |
* | "The paging self-check hasn't run yet. Once it runs, a test page goes through Brigade every minute." |
*
* @param {Paging_UnknownInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_unknown: ((inputs?: Paging_UnknownInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_UnknownInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
