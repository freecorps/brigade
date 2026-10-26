export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_GoneInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_GoneInputs */
/**
* | output |
* | --- |
* | "The policy no longer exists." |
*
* @param {Escalation_GoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_gone: ((inputs?: Escalation_GoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_GoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
