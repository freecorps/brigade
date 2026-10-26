export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Policy_NamedInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Escalation_Policy_NamedInputs */
/**
* | output |
* | --- |
* | "Policy: {name}" |
*
* @param {Escalation_Policy_NamedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_policy_named: ((inputs: Escalation_Policy_NamedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Policy_NamedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
