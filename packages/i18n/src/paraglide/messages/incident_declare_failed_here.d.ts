export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Declare_Failed_HereInputs = {
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown> }} Incident_Declare_Failed_HereInputs */
/**
* | output |
* | --- |
* | "Couldn't declare it. {reason}" |
*
* @param {Incident_Declare_Failed_HereInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_declare_failed_here: ((inputs: Incident_Declare_Failed_HereInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Declare_Failed_HereInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
