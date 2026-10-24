export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Status_MonitoringInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_Status_MonitoringInputs */
/**
* | output |
* | --- |
* | "Monitoring" |
*
* @param {Incident_Status_MonitoringInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_status_monitoring: ((inputs?: Incident_Status_MonitoringInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Status_MonitoringInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
