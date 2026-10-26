export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Action_OnInputs = {
    action: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ action: NonNullable<unknown>, name: NonNullable<unknown> }} Escalation_Action_OnInputs */
/**
* | action | output |
* | --- | --- |
* | "edit" | "Edit {name}" |
* | "remove_target" | "Remove {name}" |
* | "remove_level" | "Remove {name}" |
* | * | "{name}" |
*
* @param {Escalation_Action_OnInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_action_on: ((inputs: Escalation_Action_OnInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Action_OnInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
