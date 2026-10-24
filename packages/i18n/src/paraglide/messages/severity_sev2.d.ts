export type LocalizedString = import('../runtime.js').LocalizedString;
export type Severity_Sev2Inputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Severity_Sev2Inputs */
/**
* | output |
* | --- |
* | "High" |
*
* @param {Severity_Sev2Inputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const severity_sev2: ((inputs?: Severity_Sev2Inputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Severity_Sev2Inputs, {
    locale?: "en" | "pt-BR";
}, {}>;
