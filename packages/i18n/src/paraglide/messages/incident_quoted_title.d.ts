export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Quoted_TitleInputs = {
    title: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ title: NonNullable<unknown> }} Incident_Quoted_TitleInputs */
/**
* | output |
* | --- |
* | "“{title}”" |
*
* @param {Incident_Quoted_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_quoted_title: ((inputs: Incident_Quoted_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Quoted_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
