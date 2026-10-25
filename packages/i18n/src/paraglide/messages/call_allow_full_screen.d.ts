export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_Allow_Full_ScreenInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Call_Allow_Full_ScreenInputs */
/**
* | output |
* | --- |
* | "Allow full-screen alerts" |
*
* @param {Call_Allow_Full_ScreenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_allow_full_screen: ((inputs?: Call_Allow_Full_ScreenInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Allow_Full_ScreenInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
