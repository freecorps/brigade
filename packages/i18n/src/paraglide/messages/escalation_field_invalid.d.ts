export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Field_InvalidInputs = {
    field: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown> }} Escalation_Field_InvalidInputs */
/**
* | field | output |
* | --- | --- |
* | "name" | "Enter a name." |
* | "timeout" | "Enter a whole number of minutes from 1 to 1440." |
* | "repeat" | "Enter a whole number from 0 to 9." |
* | "targets" | "Add at least one schedule or person." |
* | * | "Check this field." |
*
* @param {Escalation_Field_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_field_invalid: ((inputs: Escalation_Field_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Field_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
