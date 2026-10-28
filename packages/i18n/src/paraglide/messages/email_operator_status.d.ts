export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_Operator_StatusInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Email_Operator_StatusInputs */
/**
* | part | output |
* | --- | --- |
* | "subject_degraded" | "Brigade's paging self-check is degraded" |
* | "subject_ok" | "Brigade's paging self-check is back to normal" |
* | "subject_unknown" | "Brigade's paging self-check changed" |
* | "intro_degraded" | "The paging self-check of this Brigade instance found a problem. Pages may be late or may not go out until it's fixed:" |
* | "intro_ok" | "The paging self-check of this Brigade instance is passing again: a heartbeat went through the event queue and the push relay." |
* | "intro_unknown" | "The paging self-check of this Brigade instance has no result yet." |
* | "how" | "The Worker's logs have the details (search for \"paging pipeline\"). GET /health/paging shows the state as members see it." |
* | "footer" | "You get this email because your address is in OPERATOR_EMAILS for this Brigade instance." |
* | * | "Brigade's paging self-check changed" |
*
* @param {Email_Operator_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_operator_status: ((inputs: Email_Operator_StatusInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Operator_StatusInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
