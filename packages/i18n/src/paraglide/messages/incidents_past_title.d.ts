export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Past_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incidents_Past_TitleInputs */
/**
* | output |
* | --- |
* | "Past incidents" |
*
* @param {Incidents_Past_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_past_title: ((inputs?: Incidents_Past_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Past_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
