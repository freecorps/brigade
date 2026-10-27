export type LocalizedString = import('../runtime.js').LocalizedString;
export type Alerts_CardInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    value: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, value: NonNullable<unknown> }} Alerts_CardInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Alert sources" |
* | "description" | "Grafana, Datadog, Sentry or anything that sends a webhook posts alerts to a secret URL. Routes decide which alerts open incidents and who is paged." |
* | "load_failed" | "Couldn't load alert sources." |
* | "retry" | "Try again" |
* | "add" | "Add source" |
* | "sources_empty" | "No alert sources yet. Add one to get a URL to paste into your monitoring tool." |
* | "manage_only" | "Only owners and admins add alert sources and change routes." |
* | "name_label" | "Name" |
* | "name_required" | "Give the source a name." |
* | "kind_label" | "Sent by" |
* | "kind_generic" | "Any webhook" |
* | "kind_grafana" | "Grafana" |
* | "kind_datadog" | "Datadog" |
* | "kind_sentry" | "Sentry" |
* | "header_label" | "Extra header (optional)" |
* | "header_hint" | "Brigade also checks this header. For Basic auth, use Authorization." |
* | "header_value_label" | "Header value" |
* | "header_invalid" | "Use letters, digits and hyphens, and not a header the transport uses." |
* | "header_value_required" | "Enter the value the header carries." |
* | "secret_label_sentry" | "Client secret" |
* | "secret_hint_sentry" | "From your Sentry internal integration. Brigade checks every webhook's signature with it." |
* | "secret_label_grafana" | "HMAC secret (optional)" |
* | "secret_hint_grafana" | "Set the same secret in the contact point's HMAC signature settings." |
* | "secret_required" | "Sentry signs every webhook: paste its client secret." |
* | "secret_invalid" | "Use 8 to 256 characters, without spaces." |
* | "create" | "Create source" |
* | "creating" | "Creating…" |
* | "cancel" | "Cancel" |
* | "create_failed" | "Couldn't create the source. Try again." |
* | "limit" | "This workspace has as many alert sources as it can ({value}). Delete one to add another." |
* | "url_once" | "Copy this URL now. Brigade keeps only a hash of it, so it is shown once." |
* | "url_rotated" | "New URL for {name}. The old one no longer works." |
* | "copy" | "Copy" |
* | "copied" | "Copied" |
* | "close_prompt" | "Close without copying? You'd need a new URL." |
* | "keep" | "Keep it open" |
* | "close" | "Close" |
* | "setup_title" | "Where to paste it" |
* | "setup_grafana" | "In Grafana, open Alerting, then Contact points, and add a Webhook integration with this URL and the POST method. Under Optional Webhook settings, set Max ale..." |
* | "setup_grafana_hmac" | "Under Optional Webhook settings, set HMAC Signature to the secret you gave Brigade. Keep the default signature header and leave the timestamp header empty." |
* | "setup_datadog" | "In Datadog, open Integrations, then Webhooks, and add a webhook named brigade with this URL and the payload below. Then add @webhook-brigade to a monitor's m..." |
* | "setup_sentry" | "In Sentry, open Settings, then Developer Settings, and create an internal integration with this webhook URL. Turn on Alert Rule Action, copy its client secre..." |
* | "setup_generic" | "POST JSON to this URL. Only title is required. Send the same dedup_key while the alert fires, and status resolved when it's over." |
* | "setup_header" | "Also send the header {name} with the value you entered." |
* | "setup_show" | "How to connect it" |
* | "last_received" | "Last alert {value}" |
* | "never_received" | "No alert received yet" |
* | "signed" | "Signature checked" |
* | "header_checked" | "Checks {name}" |
* | "rotate" | "New URL" |
* | "rotate_confirm" | "The current URL stops working at once. Update whatever sends to it." |
* | "rotate_failed" | "Couldn't make a new URL. The current one still works." |
* | "delete" | "Delete" |
* | "delete_confirm" | "Delete {name}? Its URL stops working and its firing alerts resolve. Incidents they opened stay open." |
* | "delete_failed" | "Couldn't delete it. Try again." |
* | "keep_source" | "Keep it" |
* | "routes_title" | "Alert routes" |
* | "routes_hint" | "Tried from the top: the first route that matches decides. An alert no route matches opens an incident at its own severity, paged through the default policy." |
* | "default_route" | "Everything else" |
* | "default_route_action" | "Opens an incident at the alert's severity, paged through the default policy. Unreadable payloads always come here." |
* | "route_name" | "Route name" |
* | "route_name_required" | "Give the route a name." |
* | "match_sources" | "From" |
* | "any_source" | "Any source" |
* | "match_severities" | "Alert severity" |
* | "any_severity" | "Any severity" |
* | "severity_critical" | "Critical" |
* | "severity_high" | "High" |
* | "severity_warning" | "Warning" |
* | "severity_info" | "Info" |
* | "match_labels" | "Labels" |
* | "labels_hint" | "key=value, separated by commas. A key alone matches any value." |
* | "labels_invalid" | "Write each label as key=value, at most 10." |
* | "action_label" | "Then" |
* | "action_open" | "Open an incident" |
* | "action_group" | "Group into one open incident" |
* | "action_suppress" | "Keep the alert, open no incident" |
* | "action_drop" | "Drop it" |
* | "severity_label" | "Incident severity" |
* | "severity_from_alert" | "The alert's own" |
* | "policy_label" | "Escalation policy" |
* | "policy_default" | "Default policy" |
* | "type_label" | "Incident type" |
* | "type_none" | "No type" |
* | "services_label" | "Services" |
* | "group_by" | "Group by label" |
* | "group_by_hint" | "Alerts with the same value of this label join one open incident." |
* | "group_by_required" | "Name the label to group by." |
* | "add_route" | "Add route" |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "save_failed" | "Couldn't save the route. Try again." |
* | "edit" | "Edit" |
* | "move_up" | "Move up" |
* | "move_down" | "Move down" |
* | "route_limit" | "This workspace has as many routes as it can ({value})." |
* | "any_alert" | "Any alert" |
* | "deleted_source" | "a deleted source" |
* | "recent_title" | "Recent alerts" |
* | "recent_empty" | "No alerts received yet." |
* | "status_firing" | "Firing" |
* | "status_resolved" | "Resolved" |
* | "status_closed" | "Closed" |
* | "outcome_opened" | "Opened {name}" |
* | "outcome_grouped" | "Added to {name}" |
* | "outcome_suppressed" | "Suppressed, no incident" |
* | "outcome_dropped" | "Dropped" |
* | "outcome_resolved_early" | "Its resolve came first, so no incident" |
* | "via_route" | "Route: {name}" |
* | "via_default" | "Default route" |
* | "via_malformed" | "Unreadable payload, so the default route took it" |
* | "via_capacity" | "Too many alerts firing, so it paged as the capacity alert" |
* | "route_disabled" | "Off since the account that created it was taken back. Save it to turn it on again." |
* | "source_link" | "Open in the source" |
* | "an_incident" | "an incident" |
* | "mapping" | "Title and severity" |
* | "mapping_title" | "Title and severity for {name}" |
* | "mapping_hint" | "Applied to every alert this source sends from now on, before the routes see it. Alerts already in keep theirs." |
* | "mapped" | "Title and severity mapped" |
* | "template_label" | "Title template (optional)" |
* | "template_hint" | "Empty: the alert's own title. A label the alert doesn't have is left blank." |
* | "template_fields" | "Placeholders the alert fills in:" |
* | "template_any_label" | "or any label:" |
* | "template_insert" | "Add {name} to the title" |
* | "template_unknown_field" | "Use only the placeholders listed below." |
* | "template_unclosed" | "A placeholder is never closed." |
* | "template_stray_brace" | "A closing brace closes nothing." |
* | "template_too_many_fields" | "Use at most 10 placeholders." |
* | "severity_source" | "Read the severity from" |
* | "severity_source_provider" | "The sender's own severity or priority" |
* | "severity_source_label" | "A label" |
* | "severity_label_key" | "Label" |
* | "severity_label_required" | "Name the label to read." |
* | "rules_title" | "Map these values" |
* | "rules_empty" | "No values mapped: the severity Brigade read stays, unless you pick one for anything else." |
* | "rule_value" | "Value" |
* | "rule_severity" | "Severity" |
* | "add_rule" | "Add value" |
* | "remove_rule" | "Remove {name}" |
* | "rule_value_required" | "Enter the value, or remove the row." |
* | "rule_duplicate" | "Each value once." |
* | "rules_limit" | "At most {value} values." |
* | "fallback_label" | "Anything else" |
* | "fallback_keep" | "The severity Brigade read" |
* | "preview_title" | "Preview with the latest alert" |
* | "preview_empty" | "No alert from this source yet. The preview appears once one arrives." |
* | "preview_sent" | "Sent" |
* | "preview_becomes" | "Becomes" |
* | "preview_sender_word" | "Sender's severity: {value}" |
* | "preview_no_word" | "The sender gave no severity" |
* | "preview_route" | "Route" |
* | "preview_route_default" | "No route matches: it opens an incident at its own severity, paged through the default policy." |
* | "mapping_reset" | "Use the sender's" |
* | "mapping_save_failed" | "Couldn't save the title and severity. Try again." |
* | * | "Alert sources" |
*
* @param {Alerts_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const alerts_card: ((inputs: Alerts_CardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Alerts_CardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
