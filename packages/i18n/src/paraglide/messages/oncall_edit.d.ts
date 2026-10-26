export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_EditInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_EditInputs */
/**
* | output |
* | --- |
* | "Edit" |
*
* @param {Oncall_EditInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_edit: ((inputs?: Oncall_EditInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_EditInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
