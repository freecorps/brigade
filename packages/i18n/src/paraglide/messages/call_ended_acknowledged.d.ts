export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Ended_AcknowledgedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Ended_AcknowledgedInputs */
/**
* | output |
* | --- |
* | "Acknowledged. The call ended." |
*
* @param {Call_Ended_AcknowledgedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_ended_acknowledged: ((inputs?: Call_Ended_AcknowledgedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Ended_AcknowledgedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
