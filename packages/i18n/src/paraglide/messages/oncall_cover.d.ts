export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_CoverInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Oncall_CoverInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "For the next hour" |
* | * | "For the next {countFormatted} hours" |
*
* @param {Oncall_CoverInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_cover: ((inputs: Oncall_CoverInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_CoverInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
