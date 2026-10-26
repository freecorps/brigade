export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Delete_ConfirmInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Delete_ConfirmInputs */
/**
* | output |
* | --- |
* | "Delete {name}? Its overrides are deleted with it." |
*
* @param {Oncall_Delete_ConfirmInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_delete_confirm: ((inputs: Oncall_Delete_ConfirmInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Delete_ConfirmInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
