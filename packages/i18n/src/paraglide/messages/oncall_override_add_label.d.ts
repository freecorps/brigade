export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_Add_LabelInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Override_Add_LabelInputs */
/**
* | output |
* | --- |
* | "Add override to {name}" |
*
* @param {Oncall_Override_Add_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_add_label: ((inputs: Oncall_Override_Add_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_Add_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
