export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_No_SchedulesInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Widget_No_SchedulesInputs */
/**
* | output |
* | --- |
* | "No on-call schedules" |
*
* @param {Widget_No_SchedulesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_no_schedules: ((inputs?: Widget_No_SchedulesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_No_SchedulesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
