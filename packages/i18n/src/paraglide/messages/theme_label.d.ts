export type LocalizedString = import('../runtime.js').LocalizedString;
export type Theme_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Theme_LabelInputs */
/**
* | output |
* | --- |
* | "Theme" |
*
* @param {Theme_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const theme_label: ((inputs?: Theme_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Theme_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
