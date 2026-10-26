export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Default_BadgeInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Default_BadgeInputs */
/**
* | output |
* | --- |
* | "Default" |
*
* @param {Escalation_Default_BadgeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_default_badge: ((inputs?: Escalation_Default_BadgeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Default_BadgeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
