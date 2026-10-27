export type LocalizedString = import('../runtime.js').LocalizedString;
export type Webhook_EventInputs = {
    type: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ type: NonNullable<unknown> }} Webhook_EventInputs */
/**
* | type | output |
* | --- | --- |
* | "incident.declared" | "Incident declared" |
* | "incident.status_changed" | "Status changed" |
* | "incident.severity_changed" | "Severity changed" |
* | "incident.acknowledged" | "Acknowledged" |
* | "incident.update_posted" | "Update posted" |
* | "incident.update_edited" | "Update edited" |
* | "incident.update_deleted" | "Update removed" |
* | "incident.role_assigned" | "Role assigned" |
* | "alert.fired" | "Alert fired" |
* | "alert.resolved" | "Alert resolved" |
* | "monitor.status_changed" | "Monitor status changed" |
* | "escalation.paged" | "Escalation level paged" |
* | "webhook.test" | "Test event" |
* | * | "Incident declared" |
*
* @param {Webhook_EventInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const webhook_event: ((inputs: Webhook_EventInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhook_EventInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
