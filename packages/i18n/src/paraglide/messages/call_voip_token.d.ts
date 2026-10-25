export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Voip_TokenInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Voip_TokenInputs */
/**
* | output |
* | --- |
* | "VoIP push token" |
*
* @param {Call_Voip_TokenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_voip_token: ((inputs?: Call_Voip_TokenInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Voip_TokenInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
