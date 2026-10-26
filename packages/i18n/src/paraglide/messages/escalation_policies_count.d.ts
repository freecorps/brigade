export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Policies_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Escalation_Policies_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} policy" |
* | * | "{countFormatted} policies" |
*
* @param {Escalation_Policies_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_policies_count: ((inputs: Escalation_Policies_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Policies_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
