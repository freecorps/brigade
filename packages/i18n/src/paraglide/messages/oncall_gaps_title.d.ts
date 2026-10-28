export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Gaps_TitleInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Oncall_Gaps_TitleInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "A schedule has a layer with nobody in it" |
* | * | "{countFormatted} schedules have a layer with nobody in it" |
*
* @param {Oncall_Gaps_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_gaps_title: ((inputs: Oncall_Gaps_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Gaps_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
