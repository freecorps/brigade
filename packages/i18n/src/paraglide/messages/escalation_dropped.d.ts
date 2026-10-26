export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_DroppedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_DroppedInputs */
/**
* | output |
* | --- |
* | "People or schedules that are gone were taken out of this policy." |
*
* @param {Escalation_DroppedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_dropped: ((inputs?: Escalation_DroppedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_DroppedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
