export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Channel_CallsInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Channel_CallsInputs */
/**
* | output |
* | --- |
* | "Pages as calls" |
*
* @param {Call_Channel_CallsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_channel_calls: ((inputs?: Call_Channel_CallsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Channel_CallsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
