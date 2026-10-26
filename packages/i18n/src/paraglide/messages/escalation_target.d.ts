export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_TargetInputs = {
    kind: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown> }} Escalation_TargetInputs */
/**
* | kind | output |
* | --- | --- |
* | "schedule" | "Schedule" |
* | "member" | "Person" |
* | * | "Target" |
*
* @param {Escalation_TargetInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_target: ((inputs: Escalation_TargetInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_TargetInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
