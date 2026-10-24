export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Status_ResolvedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Status_ResolvedInputs */
/**
* | output |
* | --- |
* | "Resolved" |
*
* @param {Incident_Status_ResolvedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_status_resolved: ((inputs?: Incident_Status_ResolvedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Status_ResolvedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
