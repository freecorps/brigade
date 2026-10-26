export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_FieldInputs = {
    field: NonNullable<unknown>;
    form: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown>, form: NonNullable<unknown> }} Escalation_FieldInputs */
/**
* | field | form | output |
* | --- | --- | --- |
* | "name" | "label" | "Name" |
* | "timeout" | "label" | "Minutes before the next level" |
* | "repeat" | "label" | "Repeat the levels" |
* | "targets" | "label" | "Who is paged" |
* | "default" | "label" | "Use for every page (default policy)" |
* | "add_target" | "label" | "Add a schedule or a person" |
* | "name" | "invalid" | "Enter a name." |
* | "timeout" | "invalid" | "Enter a whole number of minutes from 1 to 1440." |
* | "repeat" | "invalid" | "Enter a whole number from 0 to 9." |
* | "targets" | "invalid" | "Add at least one schedule or person." |
* | * | "invalid" | "Check this field." |
* | * | * | "Field" |
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
