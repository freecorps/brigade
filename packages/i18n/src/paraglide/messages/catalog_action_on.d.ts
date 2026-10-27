export type LocalizedString = import('../runtime.js').LocalizedString;
export type Catalog_Action_OnInputs = {
    action: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ action: NonNullable<unknown>, name: NonNullable<unknown> }} Catalog_Action_OnInputs */
/**
* | action | output |
* | --- | --- |
* | "edit" | "Edit {name}" |
* | "remove" | "Remove {name}" |
* | "clear" | "Clear {name}" |
* | "option" | "Option {name}" |
* | "restore" | "Restore {name}" |
* | "item" | "Responsibility {name}" |
* | * | "{name}" |
*
* @param {Catalog_Action_OnInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const catalog_action_on: ((inputs: Catalog_Action_OnInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_Action_OnInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
