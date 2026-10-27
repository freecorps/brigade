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
* | "resolved" | "Stopped: resolved {time}" |
* | "next_level" | "Level {level} at {time}" |
* | "next_repeat" | "Level 1 again at {time}" |
* | "next_end" | "Everyone who can respond at {time}" |
* | "fallback_unreachable" | "No level could reach anyone: paged everyone who can respond" |
* | "fallback_exhausted" | "Nobody acknowledged after every level: paged everyone who can respond" |
* | "fallback_stalled" | "A level kept failing to fire: paged everyone who can respond" |
* | "fallback_unreachable_later" | "No later level could reach anyone: paged everyone who can respond" |
* | "fallback_unreachable_nobody" | "No level could reach anyone. Tried everyone who can respond: nobody could be paged" |
* | "fallback_unreachable_later_nobody" | "No later level could reach anyone. Tried everyone who can respond: nobody could be paged" |
* | "fallback_exhausted_nobody" | "Nobody acknowledged after every level. Tried everyone who can respond: nobody could be paged" |
* | "fallback_stalled_nobody" | "A level kept failing to fire. Tried everyone who can respond: nobody could be paged" |
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
