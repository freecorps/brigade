export type LocalizedString = import('../runtime.js').LocalizedString;
export type Legend_SeverityInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Legend_SeverityInputs */
/**
* | output |
* | --- |
* | "Severity" |
*
* @param {Legend_SeverityInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const legend_severity: ((inputs?: Legend_SeverityInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Legend_SeverityInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
