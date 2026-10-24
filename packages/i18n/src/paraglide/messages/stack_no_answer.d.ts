export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_No_AnswerInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_No_AnswerInputs */
/**
* | output |
* | --- |
* | "No answer" |
*
* @param {Stack_No_AnswerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_no_answer: ((inputs?: Stack_No_AnswerInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_No_AnswerInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
