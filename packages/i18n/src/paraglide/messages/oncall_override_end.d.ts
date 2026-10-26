export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_EndInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Override_EndInputs */
/**
* | output |
* | --- |
* | "Until" |
*
* @param {Oncall_Override_EndInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_end: ((inputs?: Oncall_Override_EndInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_EndInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
