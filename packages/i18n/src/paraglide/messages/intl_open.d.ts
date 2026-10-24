export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_OpenInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_OpenInputs */
/**
* | output |
* | --- |
* | "Intl diagnostics" |
*
* @param {Intl_OpenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_open: ((inputs?: Intl_OpenInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_OpenInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
