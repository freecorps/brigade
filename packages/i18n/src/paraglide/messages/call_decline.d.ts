export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_DeclineInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_DeclineInputs */
/**
* | output |
* | --- |
* | "Decline" |
*
* @param {Call_DeclineInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_decline: ((inputs?: Call_DeclineInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_DeclineInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
