export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitors_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Monitors_CountInputs */
/**
* | countExact | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "No monitors" |
* | * | "one" | "{countFormatted} monitor" |
* | * | * | "{countFormatted} monitors" |
*
* @param {Monitors_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitors_count: ((inputs: Monitors_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitors_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
