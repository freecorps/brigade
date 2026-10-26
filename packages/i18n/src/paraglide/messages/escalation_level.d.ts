export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_LevelInputs = {
    level: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ level: NonNullable<unknown> }} Escalation_LevelInputs */
/**
* | output |
* | --- |
* | "Level {level}" |
*
* @param {Escalation_LevelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_level: ((inputs: Escalation_LevelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_LevelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
