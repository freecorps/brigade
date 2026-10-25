export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Method_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Method_LabelInputs */
/**
* | output |
* | --- |
* | "Method" |
*
* @param {Monitor_Method_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_method_label: ((inputs?: Monitor_Method_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Method_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
