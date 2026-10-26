export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_SelfInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Override_SelfInputs */
/**
* | output |
* | --- |
* | "You can add overrides for yourself." |
*
* @param {Oncall_Override_SelfInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_self: ((inputs?: Oncall_Override_SelfInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_SelfInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
