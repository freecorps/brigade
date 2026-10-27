export type LocalizedString = import('../runtime.js').LocalizedString;
export type Takeover_Sources_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Takeover_Sources_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} alert source URL turned off" |
* | * | "{countFormatted} alert source URLs turned off" |
*
* @param {Takeover_Sources_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const takeover_sources_count: ((inputs: Takeover_Sources_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_Sources_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
