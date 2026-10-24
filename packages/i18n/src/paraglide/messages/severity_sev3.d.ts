export type LocalizedString = import('../runtime.js').LocalizedString;
export type Severity_Sev3Inputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Severity_Sev3Inputs */
/**
* | output |
* | --- |
* | "Medium" |
*
* @param {Severity_Sev3Inputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const severity_sev3: ((inputs?: Severity_Sev3Inputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Severity_Sev3Inputs, {
    locale?: "en" | "pt-BR";
}, {}>;
