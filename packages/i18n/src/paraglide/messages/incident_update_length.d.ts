export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Update_LengthInputs = {
    count: NonNullable<unknown>;
    max: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown>, max: NonNullable<unknown> }} Incident_Update_LengthInputs */
/**
* | output |
* | --- |
* | "{count} of {max} characters" |
*
* @param {Incident_Update_LengthInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_update_length: ((inputs: Incident_Update_LengthInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Update_LengthInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
