export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_GroupInputs = {
    group: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ group: NonNullable<unknown> }} Escalation_GroupInputs */
/**
* | group | output |
* | --- | --- |
* | "schedules" | "Schedules (whoever is on call)" |
* | "people" | "People" |
* | * | "Targets" |
*
* @param {Escalation_GroupInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_group: ((inputs: Escalation_GroupInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_GroupInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
