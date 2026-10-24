export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Check_AgainInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Check_AgainInputs */
/**
* | output |
* | --- |
* | "Check again" |
*
* @param {Stack_Check_AgainInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_check_again: ((inputs?: Stack_Check_AgainInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Check_AgainInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
