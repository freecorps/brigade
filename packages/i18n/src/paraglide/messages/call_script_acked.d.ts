export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Script_AckedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Script_AckedInputs */
/**
* | output |
* | --- |
* | "Acknowledged. Thank you." |
*
* @param {Call_Script_AckedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_script_acked: ((inputs?: Call_Script_AckedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Script_AckedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
