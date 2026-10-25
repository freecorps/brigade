export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_AcknowledgedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_AcknowledgedInputs */
/**
* | output |
* | --- |
* | "Acknowledged" |
*
* @param {Call_AcknowledgedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_acknowledged: ((inputs?: Call_AcknowledgedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_AcknowledgedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
