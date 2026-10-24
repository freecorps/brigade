export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_AnsweredInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_AnsweredInputs */
/**
* | output |
* | --- |
* | "Answered" |
*
* @param {Stack_AnsweredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_answered: ((inputs?: Stack_AnsweredInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_AnsweredInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
