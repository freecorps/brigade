export type LocalizedString = import('../runtime.js').LocalizedString;
export type Takeover_Paused_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Takeover_Paused_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} monitor paused" |
* | * | "{countFormatted} monitors paused" |
*
* @param {Takeover_Paused_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const takeover_paused_count: ((inputs: Takeover_Paused_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_Paused_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
