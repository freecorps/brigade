export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Min_SeverityInputs = {
    choice: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ choice: NonNullable<unknown> }} Escalation_Min_SeverityInputs */
/**
* | choice | output |
* | --- | --- |
* | "every" | "Every severity" |
* | "sev1" | "SEV1 only" |
* | "sev2" | "SEV2 and SEV1" |
* | "sev3" | "SEV3, SEV2 and SEV1" |
* | "summary_sev1" | "Escalates for SEV1 only" |
* | "summary_sev2" | "Escalates for SEV2 and SEV1" |
* | "summary_sev3" | "Escalates for SEV3, SEV2 and SEV1" |
* | * | "Every severity" |
*
* @param {Escalation_Min_SeverityInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_min_severity: ((inputs: Escalation_Min_SeverityInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Min_SeverityInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
