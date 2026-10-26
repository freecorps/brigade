export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_HeadingInputs = {
    heading: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ heading: NonNullable<unknown> }} Oncall_HeadingInputs */
/**
* | heading | output |
* | --- | --- |
* | "new" | "New schedule" |
* | "edit" | "Edit schedule" |
* | "layers" | "Layers" |
* | "overrides" | "Overrides" |
* | "now" | "On call now" |
* | * | "Next handoffs" |
*
* @param {Oncall_HeadingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_heading: ((inputs: Oncall_HeadingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_HeadingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
