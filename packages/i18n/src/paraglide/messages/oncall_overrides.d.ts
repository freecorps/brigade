export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_OverridesInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_OverridesInputs */
/**
* | output |
* | --- |
* | "Overrides" |
*
* @param {Oncall_OverridesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_overrides: ((inputs?: Oncall_OverridesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_OverridesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
