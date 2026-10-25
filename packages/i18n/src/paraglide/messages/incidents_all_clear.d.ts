export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_All_ClearInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incidents_All_ClearInputs */
/**
* | output |
* | --- |
* | "All clear." |
*
* @param {Incidents_All_ClearInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_all_clear: ((inputs?: Incidents_All_ClearInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_All_ClearInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
