export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Unavailable_ShortInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Unavailable_ShortInputs */
/**
* | output |
* | --- |
* | "Unavailable" |
*
* @param {Sync_Unavailable_ShortInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_unavailable_short: ((inputs?: Sync_Unavailable_ShortInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Unavailable_ShortInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
