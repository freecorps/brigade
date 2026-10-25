export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Incident_LinkInputs = {
    has: NonNullable<unknown>;
    number: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ has: NonNullable<unknown>, number: NonNullable<unknown> }} Monitor_Incident_LinkInputs */
/**
* | has | output |
* | --- | --- |
* | "yes" | "Open {number}" |
* | * | "Open incident" |
*
* @param {Monitor_Incident_LinkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_incident_link: ((inputs: Monitor_Incident_LinkInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Incident_LinkInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
