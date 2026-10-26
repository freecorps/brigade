export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Action_OnInputs = {
    action: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ action: NonNullable<unknown>, name: NonNullable<unknown> }} Oncall_Action_OnInputs */
/**
* | action | output |
* | --- | --- |
* | "edit" | "Edit {name}" |
* | "add_override" | "Add override to {name}" |
* | "remove_override" | "Remove override for {name}" |
* | "remove_layer" | "Remove layer {name}" |
* | "up" | "Move {name} up" |
* | "down" | "Move {name} down" |
* | * | "Remove {name} from the layer" |
*
* @param {Oncall_Action_OnInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_action_on: ((inputs: Oncall_Action_OnInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Action_OnInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
