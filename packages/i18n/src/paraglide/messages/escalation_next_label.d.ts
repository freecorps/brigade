export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Next_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Next_LabelInputs */
/**
* | output |
* | --- |
* | "Next" |
*
* @param {Escalation_Next_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_next_label: ((inputs?: Escalation_Next_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Next_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
