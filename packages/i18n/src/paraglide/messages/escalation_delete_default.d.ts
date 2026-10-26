export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Delete_DefaultInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Delete_DefaultInputs */
/**
* | output |
* | --- |
* | "It is the default: pages go back to the incident's commander, or to everyone who can respond." |
*
* @param {Escalation_Delete_DefaultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_delete_default: ((inputs?: Escalation_Delete_DefaultInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Delete_DefaultInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
