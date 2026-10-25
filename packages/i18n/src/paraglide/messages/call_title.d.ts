export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_TitleInputs */
/**
* | output |
* | --- |
* | "Call" |
*
* @param {Call_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_title: ((inputs?: Call_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
