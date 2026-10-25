export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Change_SavingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Change_SavingInputs */
/**
* | output |
* | --- |
* | "Saving…" |
*
* @param {Incident_Change_SavingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_change_saving: ((inputs?: Incident_Change_SavingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Change_SavingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
