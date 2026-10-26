export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_HandoffInputs = {
    unit: NonNullable<unknown>;
    day: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ unit: NonNullable<unknown>, day: NonNullable<unknown>, time: NonNullable<unknown> }} Oncall_HandoffInputs */
/**
* | unit | output |
* | --- | --- |
* | "weeks" | "hands off {day} at {time}" |
* | * | "hands off at {time}" |
*
* @param {Oncall_HandoffInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_handoff: ((inputs: Oncall_HandoffInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_HandoffInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
