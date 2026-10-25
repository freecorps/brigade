export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Change_QueuedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Change_QueuedInputs */
/**
* | output |
* | --- |
* | "Waiting to send" |
*
* @param {Incident_Change_QueuedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_change_queued: ((inputs?: Incident_Change_QueuedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Change_QueuedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
