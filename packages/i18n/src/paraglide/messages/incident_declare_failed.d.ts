export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Declare_FailedInputs = {
    title: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ title: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Declare_FailedInputs */
/**
* | output |
* | --- |
* | "Couldn't declare “{title}”. {reason}" |
*
* @param {Incident_Declare_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_declare_failed: ((inputs: Incident_Declare_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Declare_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
