export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_Deleted_ScheduleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Escalation_Deleted_ScheduleInputs */
/**
* | output |
* | --- |
* | "Deleted schedule" |
*
* @param {Escalation_Deleted_ScheduleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_deleted_schedule: ((inputs?: Escalation_Deleted_ScheduleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Deleted_ScheduleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
