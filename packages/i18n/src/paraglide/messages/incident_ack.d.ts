export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_AckInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    time: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_AckInputs */
/**
* | part | output |
* | --- | --- |
* | "action" | "Acknowledge" |
* | "hint" | "Stops paging: no further escalation level fires." |
* | "by" | "Acknowledged by {name}, {time}" |
* | "already" | "Someone else acknowledged it first." |
* | "failed" | "Couldn't acknowledge it. {reason}" |
* | * | "Acknowledge" |
*
* @param {Incident_AckInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_ack: ((inputs: Incident_AckInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_AckInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
