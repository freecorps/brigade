export type LocalizedString = import('../runtime.js').LocalizedString;
export type Api_Token_ScopeInputs = {
    scope: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ scope: NonNullable<unknown> }} Api_Token_ScopeInputs */
/**
* | scope | output |
* | --- | --- |
* | "incident_read" | "Read incidents" |
* | "incident_declare" | "Declare incidents" |
* | "incident_update" | "Update incidents" |
* | "incident_ack" | "Acknowledge incidents" |
* | "workspace_read" | "Read the workspace and its members" |
* | "workspace_manage" | "Change workspace settings" |
* | "members_manage" | "Manage members and invitations" |
* | "monitor_read" | "Read monitors" |
* | "monitor_manage" | "Manage monitors" |
* | "schedule_read" | "Read on-call schedules" |
* | "schedule_manage" | "Manage on-call schedules" |
* | "schedule_override" | "Add on-call overrides" |
* | "escalation_read" | "Read escalation policies" |
* | "escalation_manage" | "Manage escalation policies" |
* | "status_read" | "Read the status page" |
* | "status_manage" | "Manage the status page" |
* | "status_publish" | "Publish status updates" |
* | "webhook_manage" | "Manage webhooks" |
* | "catalog_read" | "Read the catalog" |
* | "catalog_manage" | "Manage the catalog" |
* | "data_export" | "Export incidents" |
* | "alert_read" | "Read alerts" |
* | "alert_manage" | "Manage alert sources" |
* | * | "Another permission" |
*
* @param {Api_Token_ScopeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const api_token_scope: ((inputs: Api_Token_ScopeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Api_Token_ScopeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
