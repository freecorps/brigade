export type LocalizedString = import('../runtime.js').LocalizedString;
export type Alert_Incident_TitleInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Alert_Incident_TitleInputs */
/**
* | part | output |
* | --- | --- |
* | "malformed" | "Unreadable alert from {name}" |
* | "capacity" | "Alert capacity reached" |
* | * | "Unreadable alert from {name}" |
*
* @param {Alert_Incident_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const alert_incident_title: ((inputs: Alert_Incident_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Alert_Incident_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
