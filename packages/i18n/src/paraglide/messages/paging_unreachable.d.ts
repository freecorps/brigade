export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_UnreachableInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_UnreachableInputs */
/**
* | output |
* | --- |
* | "Couldn't check whether pages get through" |
*
* @param {Paging_UnreachableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_unreachable: ((inputs?: Paging_UnreachableInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_UnreachableInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
