export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_WhoInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Override_WhoInputs */
/**
* | output |
* | --- |
* | "Who covers" |
*
* @param {Oncall_Override_WhoInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_who: ((inputs?: Oncall_Override_WhoInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_WhoInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
