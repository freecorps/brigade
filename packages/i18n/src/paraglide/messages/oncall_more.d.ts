export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_MoreInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Oncall_MoreInputs */
/**
* | countPlural | output |
* | --- | --- |
* | * | "+{countFormatted} more" |
*
* @param {Oncall_MoreInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_more: ((inputs: Oncall_MoreInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_MoreInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
