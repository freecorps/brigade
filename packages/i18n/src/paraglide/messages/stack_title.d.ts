export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_TitleInputs */
/**
* | output |
* | --- |
* | "Local stack" |
*
* @param {Stack_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_title: ((inputs?: Stack_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
