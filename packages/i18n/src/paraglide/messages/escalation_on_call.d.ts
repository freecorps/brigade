export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_On_CallInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Escalation_On_CallInputs */
/**
* | output |
* | --- |
* | "{name} on call now" |
*
* @param {Escalation_On_CallInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_on_call: ((inputs: Escalation_On_CallInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_On_CallInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
