export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_UnitInputs = {
    unit: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ unit: NonNullable<unknown> }} Oncall_UnitInputs */
/**
* | unit | output |
* | --- | --- |
* | "hours" | "Hours" |
* | "days" | "Days" |
* | * | "Weeks" |
*
* @param {Oncall_UnitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_unit: ((inputs: Oncall_UnitInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_UnitInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
