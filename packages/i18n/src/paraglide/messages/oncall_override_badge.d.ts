export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_BadgeInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Override_BadgeInputs */
/**
* | output |
* | --- |
* | "Override" |
*
* @param {Oncall_Override_BadgeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_badge: ((inputs?: Oncall_Override_BadgeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_BadgeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
