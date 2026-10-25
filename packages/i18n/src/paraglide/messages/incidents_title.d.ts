export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incidents_TitleInputs */
/**
* | output |
* | --- |
* | "Incidents" |
*
* @param {Incidents_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_title: ((inputs?: Incidents_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
