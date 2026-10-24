export type LocalizedString = import('../runtime.js').LocalizedString;
export type Severity_Sev4Inputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Severity_Sev4Inputs */
/**
* | output |
* | --- |
* | "Low" |
*
* @param {Severity_Sev4Inputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const severity_sev4: ((inputs?: Severity_Sev4Inputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Severity_Sev4Inputs, {
    locale?: "en" | "pt-BR";
}, {}>;
