export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_SavingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_SavingInputs */
/**
* | output |
* | --- |
* | "Saving…" |
*
* @param {Incident_SavingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_saving: ((inputs?: Incident_SavingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_SavingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
