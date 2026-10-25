export type LocalizedString = import('../runtime.js').LocalizedString;
export type Mobile_Change_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Mobile_Change_HintInputs */
/**
* | output |
* | --- |
* | "Opens the choices" |
*
* @param {Mobile_Change_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const mobile_change_hint: ((inputs?: Mobile_Change_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Change_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
