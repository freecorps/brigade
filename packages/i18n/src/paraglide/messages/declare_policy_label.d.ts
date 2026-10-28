export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Policy_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_Policy_LabelInputs */
/**
* | output |
* | --- |
* | "Escalation policy" |
*
* @param {Declare_Policy_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_policy_label: ((inputs?: Declare_Policy_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Policy_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
