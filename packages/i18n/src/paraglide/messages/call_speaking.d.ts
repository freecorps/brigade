export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_SpeakingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_SpeakingInputs */
/**
* | output |
* | --- |
* | "Reading the incident aloud" |
*
* @param {Call_SpeakingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_speaking: ((inputs?: Call_SpeakingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_SpeakingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
