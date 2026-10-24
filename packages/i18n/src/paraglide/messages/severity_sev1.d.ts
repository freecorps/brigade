export type LocalizedString = import('../runtime.js').LocalizedString;
export type Severity_Sev1Inputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Severity_Sev1Inputs */
/**
* | output |
* | --- |
* | "Critical" |
*
* @param {Severity_Sev1Inputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const severity_sev1: ((inputs?: Severity_Sev1Inputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Severity_Sev1Inputs, {
    locale?: "en" | "pt-BR";
}, {}>;
