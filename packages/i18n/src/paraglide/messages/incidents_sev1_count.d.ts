export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incidents_Sev1_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Incidents_Sev1_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} is SEV1" |
* | * | "{countFormatted} are SEV1" |
*
* @param {Incidents_Sev1_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incidents_sev1_count: ((inputs: Incidents_Sev1_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Sev1_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
