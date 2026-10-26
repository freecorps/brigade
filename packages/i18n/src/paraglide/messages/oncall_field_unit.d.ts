export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Field_UnitInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Field_UnitInputs */
/**
* | output |
* | --- |
* | "Unit" |
*
* @param {Oncall_Field_UnitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field_unit: ((inputs?: Oncall_Field_UnitInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_UnitInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
