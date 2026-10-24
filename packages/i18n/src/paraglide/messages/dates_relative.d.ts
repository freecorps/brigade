export type LocalizedString = import('../runtime.js').LocalizedString;
export type Dates_RelativeInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Dates_RelativeInputs */
/**
* | output |
* | --- |
* | "Relative" |
*
* @param {Dates_RelativeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const dates_relative: ((inputs?: Dates_RelativeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Dates_RelativeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
