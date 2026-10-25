export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitors_Down_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Monitors_Down_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} down" |
* | * | "{countFormatted} down" |
*
* @param {Monitors_Down_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitors_down_count: ((inputs: Monitors_Down_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitors_Down_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
