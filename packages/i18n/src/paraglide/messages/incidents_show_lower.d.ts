export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Show_LowerInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Incidents_Show_LowerInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Show {countFormatted} lower-severity incident" |
* | * | "Show {countFormatted} lower-severity incidents" |
*
* @param {Incidents_Show_LowerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_show_lower: ((inputs: Incidents_Show_LowerInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Show_LowerInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
