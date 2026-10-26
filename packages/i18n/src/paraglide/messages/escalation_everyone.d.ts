export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_EveryoneInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_EveryoneInputs */
/**
* | output |
* | --- |
* | "Everyone who can respond" |
*
* @param {Escalation_EveryoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_everyone: ((inputs?: Escalation_EveryoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_EveryoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
