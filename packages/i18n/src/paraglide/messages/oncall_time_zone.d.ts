export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Time_ZoneInputs = {
    zone: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ zone: NonNullable<unknown> }} Oncall_Time_ZoneInputs */
/**
* | output |
* | --- |
* | "Times in {zone}" |
*
* @param {Oncall_Time_ZoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_time_zone: ((inputs: Oncall_Time_ZoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Time_ZoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
