export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Unnumbered_Not_SentInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Unnumbered_Not_SentInputs */
/**
* | output |
* | --- |
* | "Not sent" |
*
* @param {Incident_Unnumbered_Not_SentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_unnumbered_not_sent: ((inputs?: Incident_Unnumbered_Not_SentInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Unnumbered_Not_SentInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
