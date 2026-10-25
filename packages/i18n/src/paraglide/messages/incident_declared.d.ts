export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_DeclaredInputs = {
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown> }} Incident_DeclaredInputs */
/**
* | output |
* | --- |
* | "Declared {time}" |
*
* @param {Incident_DeclaredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_declared: ((inputs: Incident_DeclaredInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_DeclaredInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
