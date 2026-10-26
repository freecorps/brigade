export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_ActionInputs = {
    action: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ action: NonNullable<unknown> }} Oncall_ActionInputs */
/**
* | action | output |
* | --- | --- |
* | "add_schedule" | "Add schedule" |
* | "add_override" | "Add override" |
* | "add_layer" | "Add layer" |
* | "edit" | "Edit" |
* | "create" | "Create schedule" |
* | "save" | "Save changes" |
* | "cancel" | "Cancel" |
* | "delete_schedule" | "Delete schedule" |
* | * | "Delete" |
*
* @param {Oncall_ActionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_action: ((inputs: Oncall_ActionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_ActionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
