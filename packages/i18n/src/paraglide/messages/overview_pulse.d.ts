export type LocalizedString = import('../runtime.js').LocalizedString;
export type Overview_PulseInputs = {
    part: NonNullable<unknown>;
    count: NonNullable<unknown>;
    total: NonNullable<unknown>;
    share: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, count: NonNullable<unknown>, total: NonNullable<unknown>, share: NonNullable<unknown> }} Overview_PulseInputs */
/**
* | part | output |
* | --- | --- |
* | "incidents_label" | "Active incidents" |
* | "incidents_clear" | "All clear" |
* | "incidents_link" | "Open incidents" |
* | "monitors_label" | "Monitors" |
* | "monitors_up" | "{count} of {total} up" |
* | "monitors_none" | "No monitors yet" |
* | "monitors_link" | "Open monitors" |
* | "follow_label" | "Open follow-ups" |
* | "follow_overdue" | "Overdue: {count}" |
* | "follow_none" | "Nothing overdue" |
* | "follow_link" | "Open follow-ups" |
* | "glance_title" | "Monitors" |
* | "glance_description" | "Each monitor's recent checks, every region on one line." |
* | "glance_all" | "All monitors" |
* | "recent_up" | "{share} up in recent checks" |
* | "regions" | "Regions: {count}" |
* | "regions_down" | "{count} of {total} regions down" |
* | "no_history" | "No checks yet" |
* | "alerts_title" | "Alerts, last 24 hours" |
* | "alerts_description" | "Alerts that started firing in each hour, from every alert source." |
* | "alerts_total" | "Total: {count}" |
* | "alerts_row" | "Alerts" |
* | * | "Brigade" |
*
* @param {Overview_PulseInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const overview_pulse: ((inputs: Overview_PulseInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Overview_PulseInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
