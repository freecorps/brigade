export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_QueuedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_QueuedInputs */
/**
* | output |
* | --- |
* | "Waiting to send" |
*
* @param {Incident_QueuedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_queued: ((inputs?: Incident_QueuedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_QueuedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
