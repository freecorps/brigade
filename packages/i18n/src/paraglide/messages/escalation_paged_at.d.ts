export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Paged_AtInputs = {
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown> }} Escalation_Paged_AtInputs */
/**
* | output |
* | --- |
* | "Paged {time}" |
*
* @param {Escalation_Paged_AtInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_paged_at: ((inputs: Escalation_Paged_AtInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Paged_AtInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
