export type LocalizedString = import('../runtime.js').LocalizedString;
export type Language_Name_EnInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Language_Name_EnInputs */
/**
* | output |
* | --- |
* | "English" |
*
* @param {Language_Name_EnInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const language_name_en: ((inputs?: Language_Name_EnInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Language_Name_EnInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
