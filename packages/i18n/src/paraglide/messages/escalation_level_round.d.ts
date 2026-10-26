export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Level_RoundInputs = {
    level: NonNullable<unknown>;
    round: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ level: NonNullable<unknown>, round: NonNullable<unknown> }} Escalation_Level_RoundInputs */
/**
* | round | output |
* | --- | --- |
* | "0" | "{level}" |
* | * | "{level} (repeat {round})" |
*
* @param {Escalation_Level_RoundInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_level_round: ((inputs: Escalation_Level_RoundInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Level_RoundInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
