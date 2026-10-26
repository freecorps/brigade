export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Field_Handoff_TimeInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Field_Handoff_TimeInputs */
/**
* | output |
* | --- |
* | "Handoff time" |
*
* @param {Oncall_Field_Handoff_TimeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field_handoff_time: ((inputs?: Oncall_Field_Handoff_TimeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_Handoff_TimeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
