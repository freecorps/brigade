export type LocalizedString = import('../runtime.js').LocalizedString;
export type Status_TextInputs = {
    part: NonNullable<unknown>;
    time: NonNullable<unknown>;
    list: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, list: NonNullable<unknown> }} Status_TextInputs */
/**
* | part | output |
* | --- | --- |
* | "public_investigating" | "Investigating" |
* | "public_identified" | "Identified" |
* | "public_monitoring" | "Monitoring" |
* | "public_resolved" | "Resolved" |
* | "component_operational" | "Operational" |
* | "component_degraded" | "Degraded performance" |
* | "component_partial_outage" | "Partial outage" |
* | "component_major_outage" | "Major outage" |
* | "overall_operational" | "All systems operational" |
* | "overall_degraded" | "Some systems are slower than usual" |
* | "overall_partial_outage" | "Some systems are down" |
* | "overall_major_outage" | "Major outage" |
* | "active_title" | "Current incidents" |
* | "history_title" | "Past incidents" |
* | "history_hint" | "The last 90 days." |
* | "history_empty" | "No incidents in the last 90 days." |
* | "components_title" | "Components" |
* | "components_empty" | "No components listed yet." |
* | "affects" | "Affects {list}" |
* | "updated" | "Updated {time} UTC" |
* | "update_at" | "{time} UTC" |
* | "resolved_at" | "Resolved {time} UTC" |
* | "not_found_title" | "No status page here" |
* | "not_found_body" | "This address has no status page, or it isn't public right now." |
* | "unavailable_title" | "Status page unavailable" |
* | "unavailable_body" | "The status page can't be shown right now. Try again in a minute." |
* | "powered" | "Status page by Brigade" |
* | "component_maintenance" | "Under maintenance" |
* | "overall_maintenance" | "Scheduled maintenance in progress" |
* | * | "Status" |
*
* @param {Status_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const status_text: ((inputs: Status_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
