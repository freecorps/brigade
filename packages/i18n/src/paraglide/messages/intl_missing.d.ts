export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_MissingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_MissingInputs */
/**
* | output |
* | --- |
* | "Missing" |
*
* @param {Intl_MissingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_missing: ((inputs?: Intl_MissingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_MissingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
