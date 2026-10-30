export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Empty_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Empty_HintInputs */
/**
* | output |
* | --- |
* | "A schedule says who is on call and when they hand off." |
*
* @param {Oncall_Empty_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_empty_hint: ((inputs?: Oncall_Empty_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Empty_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
