export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Count_InvalidInputs = {
    max: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ max: NonNullable<unknown> }} Oncall_Count_InvalidInputs */
/**
* | output |
* | --- |
* | "Enter a whole number from 1 to {max}." |
*
* @param {Oncall_Count_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_count_invalid: ((inputs: Oncall_Count_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Count_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
