export type LocalizedString = import('../runtime.js').LocalizedString;
export type Catalog_ActionInputs = {
    action: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ action: NonNullable<unknown> }} Catalog_ActionInputs */
/**
* | action | output |
* | --- | --- |
* | "add_service" | "New service" |
* | "add_type" | "New type" |
* | "add_field" | "New field" |
* | "edit" | "Edit" |
* | "save" | "Save" |
* | "create_service" | "Create service" |
* | "create_type" | "Create type" |
* | "create_field" | "Create field" |
* | "cancel" | "Cancel" |
* | "delete_service" | "Delete service" |
* | "delete_type" | "Delete type" |
* | "delete_field" | "Delete field" |
* | "delete" | "Delete" |
* | "add_option" | "Add an option" |
* | "clear" | "Clear" |
* | "open" | "Open" |
* | * | "Change" |
*
* @param {Catalog_ActionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const catalog_action: ((inputs: Catalog_ActionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_ActionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
