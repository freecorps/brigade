export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Schedules_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Oncall_Schedules_CountInputs */
/**
* | countExact | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "No schedules" |
* | * | "one" | "{countFormatted} schedule" |
* | * | * | "{countFormatted} schedules" |
*
* @param {Oncall_Schedules_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_schedules_count: ((inputs: Oncall_Schedules_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Schedules_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
