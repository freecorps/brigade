export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Progress_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Progress_TitleInputs */
/**
* | output |
* | --- |
* | "Escalation" |
*
* @param {Escalation_Progress_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_progress_title: ((inputs?: Escalation_Progress_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Progress_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
