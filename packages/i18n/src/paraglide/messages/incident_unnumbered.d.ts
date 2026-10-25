export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_UnnumberedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Incident_UnnumberedInputs */
/**
* | output |
* | --- |
* | "No number yet" |
*
* @param {Incident_UnnumberedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_unnumbered: ((inputs?: Incident_UnnumberedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_UnnumberedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
