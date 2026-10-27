export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_No_ShiftInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_No_ShiftInputs */
/**
* | output |
* | --- |
* | "No upcoming shift" |
*
* @param {Widget_No_ShiftInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_no_shift: ((inputs?: Widget_No_ShiftInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_No_ShiftInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
