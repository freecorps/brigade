export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_AcknowledgingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_AcknowledgingInputs */
/**
* | output |
* | --- |
* | "Acknowledging…" |
*
* @param {Call_AcknowledgingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_acknowledging: ((inputs?: Call_AcknowledgingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_AcknowledgingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
