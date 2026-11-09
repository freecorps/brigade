export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Past_OlderInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incidents_Past_OlderInputs */
/**
* | output |
* | --- |
* | "Show older" |
*
* @param {Incidents_Past_OlderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_past_older: ((inputs?: Incidents_Past_OlderInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Past_OlderInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
