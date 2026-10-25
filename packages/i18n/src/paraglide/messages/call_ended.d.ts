export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_EndedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_EndedInputs */
/**
* | output |
* | --- |
* | "The call ended." |
*
* @param {Call_EndedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_ended: ((inputs?: Call_EndedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_EndedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
