export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Do_DownInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Do_DownInputs */
/**
* | output |
* | --- |
* | "The Durable Object did not answer" |
*
* @param {Stack_Do_DownInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_do_down: ((inputs?: Stack_Do_DownInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Do_DownInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
