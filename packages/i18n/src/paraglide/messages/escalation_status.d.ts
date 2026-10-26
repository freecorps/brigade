export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_StatusInputs = {
    status: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ status: NonNullable<unknown>, time: NonNullable<unknown> }} Escalation_StatusInputs */
/**
* | status | output |
* | --- | --- |
* | "running" | "Escalating" |
* | "acknowledged" | "Stopped: acknowledged {time}" |
* | "resolved" | "Stopped: resolved {time}" |
* | "exhausted" | "Nobody acknowledged: no levels left since {time}" |
* | * | "Escalation" |
*
* @param {Escalation_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_status: ((inputs: Escalation_StatusInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_StatusInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
