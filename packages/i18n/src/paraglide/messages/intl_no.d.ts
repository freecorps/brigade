export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_NoInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_NoInputs */
/**
* | output |
* | --- |
* | "No" |
*
* @param {Intl_NoInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_no: ((inputs?: Intl_NoInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_NoInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
