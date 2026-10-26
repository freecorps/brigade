export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Edit_LabelInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Edit_LabelInputs */
/**
* | output |
* | --- |
* | "Edit {name}" |
*
* @param {Oncall_Edit_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_edit_label: ((inputs: Oncall_Edit_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Edit_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
