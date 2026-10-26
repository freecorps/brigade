export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Field_Time_ZoneInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Field_Time_ZoneInputs */
/**
* | output |
* | --- |
* | "Time zone" |
*
* @param {Oncall_Field_Time_ZoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field_time_zone: ((inputs?: Oncall_Field_Time_ZoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_Time_ZoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
