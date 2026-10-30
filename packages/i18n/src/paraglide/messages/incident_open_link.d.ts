export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Open_LinkInputs = {
    host: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ host: NonNullable<unknown> }} Incident_Open_LinkInputs */
/**
* | output |
* | --- |
* | "Open {host}" |
*
* @param {Incident_Open_LinkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_open_link: ((inputs: Incident_Open_LinkInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Open_LinkInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
