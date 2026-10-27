export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_EarlyInputs = {
    from: NonNullable<unknown>;
    level: NonNullable<unknown>;
    who: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ from: NonNullable<unknown>, level: NonNullable<unknown>, who: NonNullable<unknown> }} Escalation_EarlyInputs */
/**
* | output |
* | --- |
* | "Nobody on level {from} could be reached, so level {level} was paged now: {who}" |
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
