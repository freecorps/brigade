export type LocalizedString = import('../runtime.js').LocalizedString;
export type Status_UptimeInputs = {
    part: NonNullable<unknown>;
    percent: NonNullable<unknown>;
    date: NonNullable<unknown>;
    minutes: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, percent: NonNullable<unknown>, date: NonNullable<unknown>, minutes: NonNullable<unknown> }} Status_UptimeInputs */
/**
* | part | output |
* | --- | --- |
* | "summary" | "{percent}% uptime in the last 90 days" |
* | "no_data" | "No uptime data yet" |
* | "day_up" | "{date}: no downtime" |
* | "day_degraded" | "{date}: {minutes} min of downtime" |
* | "day_down" | "{date}: down for {minutes} min" |
* | "day_none" | "{date}: no data" |
* | "start" | "90 days ago" |
* | "start_short" | "30 days ago" |
* | "percent" | "{percent}% uptime" |
* | "end" | "Today" |
* | * | "Uptime" |
*
* @param {Status_UptimeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const status_uptime: ((inputs: Status_UptimeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_UptimeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
