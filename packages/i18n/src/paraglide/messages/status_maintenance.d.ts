export type LocalizedString = import('../runtime.js').LocalizedString;
export type Status_MaintenanceInputs = {
    part: NonNullable<unknown>;
    time: NonNullable<unknown>;
    until: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, until: NonNullable<unknown> }} Status_MaintenanceInputs */
/**
* | part | output |
* | --- | --- |
* | "active_title" | "Maintenance in progress" |
* | "upcoming_title" | "Scheduled maintenance" |
* | "window_upcoming" | "{time} to {until}" |
* | "window_active" | "Until {until}" |
* | "outage" | "Planned outage" |
* | "outage_hint" | "The components it affects are down while it runs." |
* | * | "Maintenance" |
*
* @param {Status_MaintenanceInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const status_maintenance: ((inputs: Status_MaintenanceInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_MaintenanceInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
