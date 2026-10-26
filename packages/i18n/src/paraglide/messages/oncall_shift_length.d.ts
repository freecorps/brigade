export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Shift_LengthInputs = {
    unit: NonNullable<unknown>;
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ unit: NonNullable<unknown>, count: NonNullable<unknown> }} Oncall_Shift_LengthInputs */
/**
* | unit | countPlural | output |
* | --- | --- | --- |
* | "hours" | "one" | "Every hour" |
* | "hours" | * | "Every {count} hours" |
* | "days" | "one" | "Daily" |
* | "days" | * | "Every {count} days" |
* | "weeks" | "one" | "Weekly" |
* | * | * | "Every {count} weeks" |
*
* @param {Oncall_Shift_LengthInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_shift_length: ((inputs: Oncall_Shift_LengthInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Shift_LengthInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
