export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_HintInputs */
/**
* | output |
* | --- |
* | "Levels page in order until someone acknowledges. A schedule pages whoever is on call when its level fires; a level nobody can be reached at is skipped at once." |
*
* @param {Escalation_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_hint: ((inputs?: Escalation_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
