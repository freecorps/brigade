export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_Operator_AnswerInputs = {
    reason: NonNullable<unknown>;
    answer: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown>, answer: NonNullable<unknown> }} Email_Operator_AnswerInputs */
/**
* | output |
* | --- |
* | "{reason} The check's answer: {answer}." |
*
* @param {Email_Operator_AnswerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_operator_answer: ((inputs: Email_Operator_AnswerInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Operator_AnswerInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
