export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_SendingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_SendingInputs */
/**
* | output |
* | --- |
* | "Saving" |
*
* @param {Incident_SendingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_sending: ((inputs?: Incident_SendingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_SendingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
