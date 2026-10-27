export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_EarlyInputs = {
    kind: NonNullable<unknown>;
    from: NonNullable<unknown>;
    level: NonNullable<unknown>;
    who: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, from: NonNullable<unknown>, level: NonNullable<unknown>, who: NonNullable<unknown> }} Escalation_EarlyInputs */
/**
* | kind | output |
* | --- | --- |
* | "level" | "Nobody on level {from} could be reached, so level {level} was paged now: {who}" |
* | * | "Nobody on level {from} could be reached and no level is left, so everyone who can respond was paged now" |
*
* @param {Escalation_EarlyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_early: ((inputs: Escalation_EarlyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_EarlyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
