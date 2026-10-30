export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Empty_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Empty_TitleInputs */
/**
* | output |
* | --- |
* | "No schedules yet" |
*
* @param {Oncall_Empty_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_empty_title: ((inputs?: Oncall_Empty_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Empty_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
