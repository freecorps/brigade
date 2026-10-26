export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Level_EmptyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Level_EmptyInputs */
/**
* | output |
* | --- |
* | "Nobody to page at this level: it is skipped until someone is added" |
*
* @param {Escalation_Level_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_level_empty: ((inputs?: Escalation_Level_EmptyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Level_EmptyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
