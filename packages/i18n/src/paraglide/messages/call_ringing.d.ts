export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_RingingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_RingingInputs */
/**
* | output |
* | --- |
* | "Incoming page" |
*
* @param {Call_RingingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_ringing: ((inputs?: Call_RingingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_RingingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
