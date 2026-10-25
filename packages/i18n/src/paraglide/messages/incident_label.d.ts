export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_LabelInputs = {
    number: NonNullable<unknown>;
    title: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ number: NonNullable<unknown>, title: NonNullable<unknown> }} Incident_LabelInputs */
/**
* | output |
* | --- |
* | "{number} “{title}”" |
*
* @param {Incident_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_label: ((inputs: Incident_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
