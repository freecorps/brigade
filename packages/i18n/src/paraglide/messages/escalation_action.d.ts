export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_ActionInputs = {
    action: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ action: NonNullable<unknown> }} Escalation_ActionInputs */
/**
* | action | output |
* | --- | --- |
* | "add_policy" | "New policy" |
* | "edit" | "Edit" |
* | "save" | "Save" |
* | "create" | "Create policy" |
* | "cancel" | "Cancel" |
* | "delete_policy" | "Delete policy" |
* | "delete" | "Delete" |
* | "add_level" | "Add a level" |
* | "remove_level" | "Remove level" |
* | "remove_target" | "Remove" |
* | "show_fewer" | "Show fewer levels" |
* | * | "Change" |
*
* @param {Escalation_ActionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_action: ((inputs: Escalation_ActionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_ActionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
