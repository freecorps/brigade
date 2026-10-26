export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_EmptyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_EmptyInputs */
/**
* | output |
* | --- |
* | "No escalation policies yet. Without a default policy, pages go to the incident's commander, or to everyone who can respond." |
*
* @param {Escalation_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_empty: ((inputs?: Escalation_EmptyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_EmptyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
