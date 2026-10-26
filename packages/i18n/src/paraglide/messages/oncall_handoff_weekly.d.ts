export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Handoff_WeeklyInputs = {
    day: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ day: NonNullable<unknown>, time: NonNullable<unknown> }} Oncall_Handoff_WeeklyInputs */
/**
* | output |
* | --- |
* | "hands off {day} at {time}" |
*
* @param {Oncall_Handoff_WeeklyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_handoff_weekly: ((inputs: Oncall_Handoff_WeeklyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Handoff_WeeklyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
