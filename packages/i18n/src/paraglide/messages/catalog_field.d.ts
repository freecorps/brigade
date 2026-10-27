export type LocalizedString = import('../runtime.js').LocalizedString;
export type Catalog_FieldInputs = {
    field: NonNullable<unknown>;
    form: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown>, form: NonNullable<unknown> }} Catalog_FieldInputs */
/**
* | field | form | output |
* | --- | --- | --- |
* | "name" | "label" | "Name" |
* | "description" | "label" | "Description (optional)" |
* | "tier" | "label" | "Criticality" |
* | "owners" | "label" | "Owners" |
* | "add_owner" | "label" | "Add a schedule or a person" |
* | "policy" | "label" | "Escalation policy" |
* | "severity" | "label" | "Default severity" |
* | "required" | "label" | "Required fields" |
* | "kind" | "label" | "Kind" |
* | "options" | "label" | "Options" |
* | "value" | "label" | "Value" |
* | "name" | "invalid" | "Enter a name." |
* | "description" | "invalid" | "Use at most 500 characters, without hidden characters." |
* | "options" | "invalid" | "Give every option a name, each one different." |
* | "text" | "invalid" | "Use 1 to 500 characters, without hidden characters." |
* | "number" | "invalid" | "Enter a number." |
* | "link" | "invalid" | "Enter a link that starts with https:// or http://." |
* | "choice" | "invalid" | "Pick at least one option." |
* | * | "invalid" | "Check this field." |
* | * | * | "Field" |
*
* @param {Catalog_FieldInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const catalog_field: ((inputs: Catalog_FieldInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_FieldInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
