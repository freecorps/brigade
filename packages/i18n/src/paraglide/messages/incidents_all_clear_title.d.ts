export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_All_Clear_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incidents_All_Clear_TitleInputs */
/**
* | output |
* | --- |
* | "All clear" |
*
* @param {Incidents_All_Clear_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_all_clear_title: ((inputs?: Incidents_All_Clear_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_All_Clear_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
