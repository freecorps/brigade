export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Field_Start_DateInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Field_Start_DateInputs */
/**
* | output |
* | --- |
* | "Starts on" |
*
* @param {Oncall_Field_Start_DateInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field_start_date: ((inputs?: Oncall_Field_Start_DateInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_Start_DateInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
