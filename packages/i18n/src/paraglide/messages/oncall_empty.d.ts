export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_EmptyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_EmptyInputs */
/**
* | output |
* | --- |
* | "No on-call schedules yet. A schedule says who is on call and when they hand off." |
*
* @param {Oncall_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_empty: ((inputs?: Oncall_EmptyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_EmptyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
