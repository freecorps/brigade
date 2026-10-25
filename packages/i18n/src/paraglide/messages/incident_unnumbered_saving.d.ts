export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Unnumbered_SavingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Unnumbered_SavingInputs */
/**
* | output |
* | --- |
* | "Saving" |
*
* @param {Incident_Unnumbered_SavingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_unnumbered_saving: ((inputs?: Incident_Unnumbered_SavingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Unnumbered_SavingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
