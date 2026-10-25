export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Grace_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Grace_LabelInputs */
/**
* | output |
* | --- |
* | "Grace (seconds)" |
*
* @param {Monitor_Grace_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_grace_label: ((inputs?: Monitor_Grace_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Grace_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
