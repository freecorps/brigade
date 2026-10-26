export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_No_DefaultInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_No_DefaultInputs */
/**
* | output |
* | --- |
* | "No default policy: pages go to the incident's commander, or to everyone who can respond." |
*
* @param {Escalation_No_DefaultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_no_default: ((inputs?: Escalation_No_DefaultInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_No_DefaultInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
