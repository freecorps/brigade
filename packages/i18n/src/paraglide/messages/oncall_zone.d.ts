export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_ZoneInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Oncall_ZoneInputs */
/**
* | part | output |
* | --- | --- |
* | "placeholder" | "Search a city or UTC offset" |
* | "empty" | "No time zone matches." |
* | "suggested" | "Suggested" |
* | "yours" | "Your time zone" |
* | * | "All time zones" |
*
* @param {Oncall_ZoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_zone: ((inputs: Oncall_ZoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_ZoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
