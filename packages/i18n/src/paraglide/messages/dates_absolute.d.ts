export type LocalizedString = import('../runtime.js').LocalizedString;
export type Dates_AbsoluteInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Dates_AbsoluteInputs */
/**
* | output |
* | --- |
* | "Date and time" |
*
* @param {Dates_AbsoluteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const dates_absolute: ((inputs?: Dates_AbsoluteInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Dates_AbsoluteInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
