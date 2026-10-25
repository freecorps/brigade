export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Severity_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_Severity_LabelInputs */
/**
* | output |
* | --- |
* | "Severity" |
*
* @param {Declare_Severity_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_severity_label: ((inputs?: Declare_Severity_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Severity_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
