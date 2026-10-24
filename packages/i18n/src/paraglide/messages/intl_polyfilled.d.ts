export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_PolyfilledInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_PolyfilledInputs */
/**
* | output |
* | --- |
* | "Polyfilled" |
*
* @param {Intl_PolyfilledInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_polyfilled: ((inputs?: Intl_PolyfilledInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_PolyfilledInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
