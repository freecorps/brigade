export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_GoneInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_GoneInputs */
/**
* | output |
* | --- |
* | "The schedule no longer exists." |
*
* @param {Oncall_GoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_gone: ((inputs?: Oncall_GoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_GoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
