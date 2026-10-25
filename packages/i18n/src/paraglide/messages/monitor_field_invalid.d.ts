export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Field_InvalidInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Field_InvalidInputs */
/**
* | output |
* | --- |
* | "Check this value." |
*
* @param {Monitor_Field_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_field_invalid: ((inputs?: Monitor_Field_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Field_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
