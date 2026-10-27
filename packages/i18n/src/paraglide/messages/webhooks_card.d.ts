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
* | "headers_label" | "Custom headers" |
* | "headers_hint" | "Optional, up to 5. Sent with every delivery, for example Authorization for your receiver. Brigade keeps the values sealed and never shows them again." |
* | "headers_none" | "No custom headers." |
* | "headers_edit" | "Edit headers" |
* | "headers_save" | "Save headers" |
* | "headers_saving" | "Saving…" |
* | "headers_saved" | "Headers saved." |
* | "headers_failed" | "Couldn't save the headers. Try again." |
* | "headers_refused" | "Brigade refused this header. Check its name and value." |
* | "headers_limit" | "Use at most 5 headers." |
* | "header_add" | "Add header" |
* | "header_remove" | "Remove header" |
* | "header_name" | "Header name" |
* | "header_value" | "Value" |
* | "header_keep" | "Unchanged" |
* | "header_name_invalid" | "Use letters, digits and hyphens, like X-Team." |
* | "header_reserved" | "Brigade sets this header itself." |
* | "header_duplicate" | "This header is listed twice." |
* | "header_value_required" | "Enter a value." |
* | "header_value_invalid" | "Use up to 1024 plain ASCII characters, without line breaks." |
* | "header_hidden" | "value hidden" |
* | "header_hint" | "ends in {when}" |
* | "replay" | "Replay" |
* | "replaying" | "Replaying…" |
* | "replay_sent" | "Replay on its way, with the same webhook-id. It shows at the top of Recent deliveries." |
* | "replay_too_soon" | "A delivery was replayed moments ago, or this endpoint reached its replays for the hour. Wait a little." |
* | "replay_off" | "Turn this endpoint on to replay a delivery." |
* | "replay_gone" | "Brigade no longer keeps this delivery, so it can't be replayed." |
* | "replay_failed" | "Couldn't replay it. Try again." |
* | "replayed" | "Replay" |
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
