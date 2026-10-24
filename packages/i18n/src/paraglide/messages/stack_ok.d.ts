export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_OkInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_OkInputs */
/**
* | output |
* | --- |
* | "Everything is running" |
*
* @param {Stack_OkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_ok: ((inputs?: Stack_OkInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_OkInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
