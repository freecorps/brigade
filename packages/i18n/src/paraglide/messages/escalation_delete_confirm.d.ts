export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Delete_ConfirmInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Escalation_Delete_ConfirmInputs */
/**
* | output |
* | --- |
* | "Delete {name}? Runs under way keep the levels they started with." |
*
* @param {Escalation_Delete_ConfirmInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_delete_confirm: ((inputs: Escalation_Delete_ConfirmInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Delete_ConfirmInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
