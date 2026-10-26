export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_TitleInputs */
/**
* | output |
* | --- |
* | "On call" |
*
* @param {Oncall_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_title: ((inputs?: Oncall_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
