export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_All_Clear_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incidents_All_Clear_HintInputs */
/**
* | output |
* | --- |
* | "New incidents show up here as soon as they're declared." |
*
* @param {Incidents_All_Clear_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_all_clear_hint: ((inputs?: Incidents_All_Clear_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_All_Clear_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
