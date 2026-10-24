export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_NativeInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_NativeInputs */
/**
* | output |
* | --- |
* | "Native" |
*
* @param {Intl_NativeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_native: ((inputs?: Intl_NativeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_NativeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
