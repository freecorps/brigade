export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Field_InvalidInputs = {
    field: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown> }} Oncall_Field_InvalidInputs */
/**
* | field | output |
* | --- | --- |
* | "name" | "Enter a name, up to 80 characters." |
* | "time_zone" | "Choose a time zone." |
* | "layer_name" | "Enter a layer name, up to 60 characters." |
* | "start_date" | "Enter a date from 2000 to 2099." |
* | "handoff_time" | "Enter a time." |
* | "members" | "Add at least one person." |
* | "user" | "Choose who covers." |
* | "start" | "Enter when the override starts." |
* | * | "End after the start, in the future, at most 90 days later." |
*
* @param {Oncall_Field_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field_invalid: ((inputs: Oncall_Field_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
