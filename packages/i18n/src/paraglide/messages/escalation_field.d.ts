export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_FieldInputs = {
    field: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown> }} Escalation_FieldInputs */
/**
* | field | output |
* | --- | --- |
* | "name" | "Name" |
* | "timeout" | "Minutes before the next level" |
* | "repeat" | "Repeat the levels" |
* | "targets" | "Who is paged" |
* | "default" | "Use for every page (default policy)" |
* | "add_target" | "Add a schedule or a person" |
* | * | "Field" |
*
* @param {Escalation_FieldInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_field: ((inputs: Escalation_FieldInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_FieldInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
