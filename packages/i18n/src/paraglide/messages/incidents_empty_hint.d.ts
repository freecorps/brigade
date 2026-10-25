export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Empty_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incidents_Empty_HintInputs */
/**
* | output |
* | --- |
* | "Declare one here and it shows up in every open tab." |
*
* @param {Incidents_Empty_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_empty_hint: ((inputs?: Incidents_Empty_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Empty_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
