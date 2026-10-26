export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_TitleInputs */
/**
* | output |
* | --- |
* | "Escalation" |
*
* @param {Escalation_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_title: ((inputs?: Escalation_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
