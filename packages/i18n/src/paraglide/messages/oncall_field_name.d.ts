export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Field_NameInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Field_NameInputs */
/**
* | output |
* | --- |
* | "Name" |
*
* @param {Oncall_Field_NameInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field_name: ((inputs?: Oncall_Field_NameInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_NameInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
