export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Handoff_DailyInputs = {
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown> }} Oncall_Handoff_DailyInputs */
/**
* | output |
* | --- |
* | "hands off at {time}" |
*
* @param {Oncall_Handoff_DailyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_handoff_daily: ((inputs: Oncall_Handoff_DailyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Handoff_DailyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
