export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Field_CountInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Field_CountInputs */
/**
* | output |
* | --- |
* | "Shift length" |
*
* @param {Oncall_Field_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field_count: ((inputs?: Oncall_Field_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
