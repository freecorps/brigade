export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_MissInputs = {
    reason: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown>, name: NonNullable<unknown> }} Escalation_MissInputs */
/**
* | reason | output |
* | --- | --- |
* | "no_devices" | "{name} (no phone registered)" |
* | "nobody_on_call" | "{name} (nobody on call)" |
* | "schedule_missing" | "A deleted schedule" |
* | "not_a_member" | "{name} (can no longer respond)" |
* | "failed" | "{name} (push failed)" |
* | * | "{name}" |
*
* @param {Escalation_MissInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_miss: ((inputs: Escalation_MissInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_MissInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
