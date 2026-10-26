export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_FieldInputs = {
    field: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown> }} Oncall_FieldInputs */
/**
* | field | output |
* | --- | --- |
* | "name" | "Name" |
* | "time_zone" | "Time zone" |
* | "layer_name" | "Layer name" |
* | "start_date" | "Starts on" |
* | "handoff_time" | "Handoff time" |
* | "count" | "Shift length" |
* | "unit" | "Unit" |
* | "members" | "People, in rotation order" |
* | "who" | "Who covers" |
* | "start" | "From" |
* | * | "Until" |
*
* @param {Oncall_FieldInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field: ((inputs: Oncall_FieldInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_FieldInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
