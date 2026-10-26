export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Form_NewInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Form_NewInputs */
/**
* | output |
* | --- |
* | "New schedule" |
*
* @param {Oncall_Form_NewInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_form_new: ((inputs?: Oncall_Form_NewInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Form_NewInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
