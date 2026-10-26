export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_StartInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Override_StartInputs */
/**
* | output |
* | --- |
* | "From" |
*
* @param {Oncall_Override_StartInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_start: ((inputs?: Oncall_Override_StartInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_StartInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
