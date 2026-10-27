export type LocalizedString = import('../runtime.js').LocalizedString;
export type Alerts_RepeatsInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Alerts_RepeatsInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Sent {countFormatted} more time" |
* | * | "Sent {countFormatted} more times" |
*
* @param {Alerts_RepeatsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const alerts_repeats: ((inputs: Alerts_RepeatsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Alerts_RepeatsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
