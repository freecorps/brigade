export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Schedule_AddInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Schedule_AddInputs */
/**
* | output |
* | --- |
* | "Add schedule" |
*
* @param {Oncall_Schedule_AddInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_schedule_add: ((inputs?: Oncall_Schedule_AddInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Schedule_AddInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
