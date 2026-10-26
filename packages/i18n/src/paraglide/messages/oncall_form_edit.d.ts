export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Form_EditInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Form_EditInputs */
/**
* | output |
* | --- |
* | "Edit schedule" |
*
* @param {Oncall_Form_EditInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_form_edit: ((inputs?: Oncall_Form_EditInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Form_EditInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
