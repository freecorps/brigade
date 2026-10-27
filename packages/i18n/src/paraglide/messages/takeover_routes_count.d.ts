export type LocalizedString = import('../runtime.js').LocalizedString;
export type Takeover_Routes_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Takeover_Routes_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} alert route turned off" |
* | * | "{countFormatted} alert routes turned off" |
*
* @param {Takeover_Routes_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const takeover_routes_count: ((inputs: Takeover_Routes_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_Routes_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
