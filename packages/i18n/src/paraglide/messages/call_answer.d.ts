export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_AnswerInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_AnswerInputs */
/**
* | output |
* | --- |
* | "Answer" |
*
* @param {Call_AnswerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_answer: ((inputs?: Call_AnswerInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_AnswerInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
