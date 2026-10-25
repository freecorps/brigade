export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Hang_UpInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Hang_UpInputs */
/**
* | output |
* | --- |
* | "Hang up" |
*
* @param {Call_Hang_UpInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_hang_up: ((inputs?: Call_Hang_UpInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Hang_UpInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
