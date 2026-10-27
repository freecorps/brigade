export type LocalizedString = import('../runtime.js').LocalizedString;
export type Api_Tokens_CardInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    when: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, when: NonNullable<unknown> }} Api_Tokens_CardInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "API tokens" |
* | "description" | "Let scripts and integrations call Brigade's API for this workspace. A token acts with your role, never beyond the scopes you give it." |
* | "add" | "Create token" |
* | "manage_only" | "Only owners and admins can create and revoke API tokens." |
* | "empty" | "No tokens yet. Create one for a script, a CI job or an integration." |
* | "load_failed" | "Couldn't load the API tokens." |
* | "retry" | "Try again" |
* | "name_label" | "Name" |
* | "name_hint" | "What uses it, so you know what breaks when you revoke it." |
* | "name_invalid" | "Give it a name of up to 60 characters." |
* | "scopes_label" | "Scopes" |
* | "scopes_none" | "Pick at least one scope." |
* | "members_note" | "A token never makes anyone an owner or admin, never changes or removes an owner or admin, and never changes its creator." |
* | "expiry_label" | "Expires" |
* | "expiry_30" | "In 30 days" |
* | "expiry_90" | "In 90 days" |
* | "expiry_365" | "In a year" |
* | "expiry_never" | "Never" |
* | "create_go" | "Create token" |
* | "creating" | "Creating…" |
* | "cancel" | "Cancel" |
* | "create_failed" | "Couldn't create the token. Try again." |
* | "forbidden" | "Your role can't grant one of those scopes." |
* | "limit" | "This workspace has 50 active tokens. Revoke one to create another." |
* | "token_created" | "Token {name} created" |
* | "token_once" | "Copy it now: Brigade keeps only a hash and won't show it again. Send it as Authorization: Bearer." |
* | "token_label" | "API token" |
* | "copy" | "Copy" |
* | "copied" | "Copied" |
* | "copy_key" | "Copy didn't work. The token is selected: press Ctrl+C." |
* | "copy_key_apple" | "Copy didn't work. The token is selected: press ⌘C." |
* | "close_prompt" | "Close without copying? You won't see this token again." |
* | "keep_open" | "Keep it open" |
* | "close" | "Close" |
* | "by" | "By {name}" |
* | "used_never" | "Never used" |
* | "used" | "Used {when}" |
* | "expires" | "Expires {when}" |
* | "expires_never" | "Doesn't expire" |
* | "state_active" | "Active" |
* | "state_revoked" | "Revoked" |
* | "state_expired" | "Expired" |
* | "state_disabled" | "Disabled: its creator left" |
* | "revoke" | "Revoke" |
* | "revoke_confirm" | "Revoke {name}? Anything using it stops working right away." |
* | "revoke_go" | "Revoke token" |
* | "revoking" | "Revoking…" |
* | "revoke_failed" | "Couldn't revoke the token. Try again." |
* | "keep" | "Keep it" |
* | "group_incident" | "Incidents" |
* | "group_workspace" | "Workspace" |
* | "group_members" | "Members" |
* | "group_monitor" | "Monitors" |
* | "group_schedule" | "On-call" |
* | "group_escalation" | "Escalation" |
* | "group_status" | "Status page" |
* | "group_webhook" | "Webhooks" |
* | "group_catalog" | "Catalog" |
* | "group_data" | "Data" |
* | "group_alert" | "Alerts" |
* | * | "API tokens" |
*
* @param {Api_Tokens_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const api_tokens_card: ((inputs: Api_Tokens_CardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Api_Tokens_CardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
