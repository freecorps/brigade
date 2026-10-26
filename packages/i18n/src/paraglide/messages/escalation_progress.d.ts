export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_ProgressInputs = {
    part: NonNullable<unknown>;
    time: NonNullable<unknown>;
    level: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, level: NonNullable<unknown> }} Escalation_ProgressInputs */
/**
* | part | output |
* | --- | --- |
* | "running" | "Escalating" |
* | "acknowledged" | "Stopped: acknowledged {time}" |
* | "resolved" | "Stopped: resolved {time}" |
* | "exhausted" | "Nobody acknowledged: no levels left since {time}" |
* | "next_level" | "Level {level} {time}" |
* | "next_repeat" | "Level 1 again {time}" |
* | "next_end" | "Gives up {time}" |
* | * | "Escalation" |
*
* @param {Escalation_ProgressInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_progress: ((inputs: Escalation_ProgressInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_ProgressInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
