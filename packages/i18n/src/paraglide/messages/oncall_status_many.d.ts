export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Status_ManyInputs = {
    time: NonNullable<unknown>;
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown>, count: NonNullable<unknown> }} Oncall_Status_ManyInputs */
/**
* | countPlural | output |
* | --- | --- |
* | * | "On call until {time} ({countFormatted} schedules)" |
*
* @param {Oncall_Status_ManyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_status_many: ((inputs: Oncall_Status_ManyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Status_ManyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
