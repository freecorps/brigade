export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_NobodyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_NobodyInputs */
/**
* | output |
* | --- |
* | "Nobody on call" |
*
* @param {Oncall_NobodyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_nobody: ((inputs?: Oncall_NobodyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_NobodyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
