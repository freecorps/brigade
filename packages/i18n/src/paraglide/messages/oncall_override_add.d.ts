export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_AddInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Override_AddInputs */
/**
* | output |
* | --- |
* | "Add override" |
*
* @param {Oncall_Override_AddInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_add: ((inputs?: Oncall_Override_AddInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_AddInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
