export type LocalizedString = import('../runtime.js').LocalizedString;
export type Language_Name_Pt_BrInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Language_Name_Pt_BrInputs */
/**
* | output |
* | --- |
* | "Português (Brasil)" |
*
* @param {Language_Name_Pt_BrInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const language_name_pt_br: ((inputs?: Language_Name_Pt_BrInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Language_Name_Pt_BrInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
