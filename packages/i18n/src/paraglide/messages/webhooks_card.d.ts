export type LocalizedString = import('../runtime.js').LocalizedString;
export type Webhooks_CardInputs = {
    part: NonNullable<unknown>;
    host: NonNullable<unknown>;
    when: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, host: NonNullable<unknown>, when: NonNullable<unknown> }} Webhooks_CardInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Webhooks" |
* | "description" | "Send signed JSON to your own services when incidents, alerts and monitors change." |
* | "add" | "Add endpoint" |
* | "manage_only" | "Only owners and admins can see and manage webhooks." |
* | "empty" | "No endpoints yet. Add one to get incidents, alerts and monitor changes as signed JSON." |
* | "load_failed" | "Couldn't load the webhooks." |
* | "retry" | "Try again" |
* | "not_configured" | "Webhooks aren't set up on this Brigade server." |
* | "limit" | "A workspace can have at most 20 endpoints. Delete one to add another." |
* | "url_label" | "Endpoint URL" |
* | "url_hint" | "HTTPS only, on a public host. Brigade doesn't follow redirects." |
* | "url_invalid" | "Enter an https:// URL on a public host, without a user name or password." |
* | "description_label" | "Description" |
* | "description_hint" | "Optional. Shown here instead of the host." |
* | "description_invalid" | "Use at most 200 visible characters." |
* | "events_label" | "Events" |
* | "events_none" | "Pick at least one event." |
* | "events_all" | "All" |
* | "group_incidents" | "Incidents" |
* | "group_monitors" | "Monitors and alerts" |
* | "group_escalation" | "Escalation" |
* | "create" | "Add endpoint" |
* | "creating" | "Adding…" |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "saved" | "Saved." |
* | "cancel" | "Cancel" |
* | "save_failed" | "Couldn't save. Try again." |
* | "exists" | "This endpoint already exists. Give it a new secret if you missed the first one." |
* | "status_on" | "On" |
* | "status_off" | "Off" |
* | "status_failing" | "Off: failing" |
* | "last_ok" | "Delivered {when}" |
* | "last_failed" | "Last delivery failed {when}" |
* | "never" | "No deliveries yet" |
* | "failing_since" | "Failing since {when}" |
* | "disabled_failing" | "Brigade turned this endpoint off {when}, after its deliveries kept failing for a day. Fix the endpoint, then turn it back on." |
* | "edit" | "Edit" |
* | "close_edit" | "Done" |
* | "turn_on" | "Turn on" |
* | "turn_off" | "Turn off" |
* | "toggle_failed" | "Couldn't change it. Try again." |
* | "test" | "Send test event" |
* | "testing" | "Sending…" |
* | "test_sent" | "Test event on its way. It shows under Recent deliveries." |
* | "test_too_soon" | "A test event went out moments ago. Wait a few seconds." |
* | "test_failed" | "Couldn't send a test event. Try again." |
* | "rotate" | "New secret" |
* | "rotate_confirm" | "Give {host} a new signing secret? Deliveries are signed with both for 24 hours, so the receiver can switch over." |
* | "rotate_go" | "Make new secret" |
* | "rotating" | "Making…" |
* | "rotate_failed" | "Couldn't make a new secret. Try again." |
* | "keep" | "Keep current" |
* | "delete" | "Delete" |
* | "delete_confirm" | "Delete {host}? Deliveries stop at once and its log is gone." |
* | "delete_go" | "Delete endpoint" |
* | "deleting" | "Deleting…" |
* | "delete_failed" | "Couldn't delete. Try again." |
* | "secret_created" | "Copy the signing secret for {host} now: Brigade won't show it again." |
* | "secret_rotated" | "New signing secret for {host}. Copy it now: Brigade won't show it again." |
* | "secret_label" | "Signing secret" |
* | "secret_verify" | "Check the webhook-signature header with any Standard Webhooks library, using this secret." |
* | "copy" | "Copy" |
* | "copied" | "Copied" |
* | "copy_key" | "Press Ctrl+C to copy it." |
* | "copy_key_apple" | "Press ⌘C to copy it." |
* | "close_prompt" | "Close without copying? You'd have to make a new secret." |
* | "keep_open" | "Keep it open" |
* | "close" | "Close" |
* | "recent_title" | "Recent deliveries" |
* | "recent_empty" | "Nothing delivered yet. Send a test event to try the endpoint." |
* | "attempt" | "Try {when}" |
* | * | "Webhooks" |
*
* @param {Webhooks_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const webhooks_card: ((inputs: Webhooks_CardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhooks_CardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
