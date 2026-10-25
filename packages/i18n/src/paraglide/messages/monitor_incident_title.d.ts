export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Incident_TitleInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Monitor_Incident_TitleInputs */
/**
* | output |
* | --- |
* | "{name} is down" |
*
* @param {Monitor_Incident_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_incident_title: ((inputs: Monitor_Incident_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Incident_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
