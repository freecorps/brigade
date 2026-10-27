export type LocalizedString = import('../runtime.js').LocalizedString;
export type Slack_TextInputs = {
    part: NonNullable<unknown>;
    incident: NonNullable<unknown>;
    title: NonNullable<unknown>;
    name: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
    list: NonNullable<unknown>;
    detail: NonNullable<unknown>;
    person: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, incident: NonNullable<unknown>, title: NonNullable<unknown>, name: NonNullable<unknown>, workspace: NonNullable<unknown>, list: NonNullable<unknown>, detail: NonNullable<unknown>, person: NonNullable<unknown> }} Slack_TextInputs */
/**
* | part | output |
* | --- | --- |
* | "message_declared_by" | "Declared by {name}" |
* | "message_acknowledged_by" | "Acknowledged by {name}" |
* | "message_not_acknowledged" | "Nobody has acknowledged it yet" |
* | "message_ack_button" | "Acknowledge" |
* | "message_open_button" | "Open in Brigade" |
* | "message_monitors" | "Brigade monitors" |
* | "message_unnamed" | "an unnamed member" |
* | "message_teammate" | "a teammate" |
* | "reply_declared" | "Declared {incident}: {title}" |
* | "reply_acknowledged" | "Acknowledged {incident}: {title}. Paging has stopped." |
* | "reply_already" | "{incident} is already acknowledged." |
* | "reply_not_active" | "{incident} is no longer active." |
* | "reply_not_found" | "There's no such incident in {workspace}." |
* | "reply_ambiguous" | "More than one incident is waiting to be acknowledged: {list}. Say which one, for example /inc ack {incident}." |
* | "reply_none" | "No active incident is waiting to be acknowledged." |
* | "reply_forbidden" | "Your role in {workspace} can't do that. Ask an owner or admin." |
* | "reply_unmapped" | "Your Slack email isn't the confirmed email of a member of {workspace} in Brigade, so Brigade can't act for you. Use the same email in both and confirm it in ..." |
* | "reply_unconfirmed" | "Brigade can't tell who you are: Slack hasn't confirmed your email, or you're a guest from another Slack workspace." |
* | "reply_not_connected" | "This Slack workspace isn't connected to Brigade. An owner or admin can connect it from the Brigade dashboard." |
* | "reply_reconnect" | "Brigade can't use this Slack workspace's connection any more. An owner or admin needs to connect Slack again from the Brigade dashboard." |
* | "reply_invalid_title" | "An incident needs a title of 1 to 200 characters, with no invisible characters." |
* | "reply_failed" | "Brigade couldn't do that right now. Try again in a moment." |
* | "reply_unknown" | "Unknown command." |
* | "usage" | "Declare an incident: /inc declare [title] [sev1 to sev4], or /inc declare alone for a form. Then: /inc ack, /inc update <text>, /inc sev <1 to 4>, /inc resol..." |
* | "message_channel" | "Incident channel: {detail}" |
* | "mirror_status" | "{name} changed the status to *{detail}*" |
* | "mirror_severity" | "{name} changed the severity to *{detail}*" |
* | "mirror_ack" | "{name} acknowledged the incident. Paging has stopped." |
* | "mirror_role" | "{name} made {person} the {detail}" |
* | "mirror_role_cleared" | "{name} left the {detail} role empty" |
* | "mirror_update" | "*Update from {name}* {detail}" |
* | "reply_updated" | "Posted to {incident}'s timeline." |
* | "reply_severity" | "{incident} is now {detail}." |
* | "reply_resolved" | "Resolved {incident}: {title}" |
* | "reply_role" | "{person} is now the {detail} of {incident}." |
* | "reply_escalated" | "Paged the next level of {incident} now." |
* | "reply_not_escalating" | "{incident} has no escalation under way, so there's no next level to page." |
* | "reply_unchanged" | "{incident} is already like that." |
* | "reply_which" | "More than one incident is active: {list}. Say which one, for example /inc {detail} {incident}." |
* | "reply_no_active" | "No incident is active." |
* | "reply_invalid_update" | "An update needs 1 to 4000 characters, with no invisible characters." |
* | "reply_unknown_role" | "There's no role called {detail}. The roles are: {list}." |
* | "reply_role_unmapped" | "Brigade can't tell which member {person} is: their Slack email isn't the confirmed email of a member of {workspace}." |
* | "reply_role_viewer" | "{person} is a viewer in {workspace}, and viewers can't hold incident roles." |
* | "reply_not_incident_channel" | "This isn't an incident's channel. To post to an incident's timeline, use /inc update INC-12 followed by the update." |
* | "reply_modal_failed" | "Brigade couldn't open the form. Try /inc declare followed by the title instead." |
* | "modal_title" | "Declare an incident" |
* | "modal_submit" | "Declare" |
* | "modal_close" | "Cancel" |
* | "modal_title_label" | "Title" |
* | "modal_title_placeholder" | "What's wrong, in a few words" |
* | "modal_severity_label" | "Severity" |
* | "modal_type_label" | "Type" |
* | "modal_type_placeholder" | "Pick a type" |
* | "modal_services_label" | "Affected services" |
* | "modal_services_placeholder" | "Pick services" |
* | * | "Brigade" |
*
* @param {Slack_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const slack_text: ((inputs: Slack_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Slack_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
