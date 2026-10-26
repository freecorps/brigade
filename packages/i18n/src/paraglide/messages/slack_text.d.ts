export type LocalizedString = import('../runtime.js').LocalizedString;
export type Slack_TextInputs = {
    part: NonNullable<unknown>;
    incident: NonNullable<unknown>;
    title: NonNullable<unknown>;
    name: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
    list: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, incident: NonNullable<unknown>, title: NonNullable<unknown>, name: NonNullable<unknown>, workspace: NonNullable<unknown>, list: NonNullable<unknown> }} Slack_TextInputs */
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
* | "reply_unmapped" | "Your Slack email isn't the email of a member of {workspace} in Brigade, so Brigade can't act for you. Use the same email in both, or ask an owner to add you." |
* | "reply_unconfirmed" | "Slack hasn't confirmed your email address, so Brigade can't tell who you are." |
* | "reply_not_connected" | "This Slack workspace isn't connected to Brigade. An owner or admin can connect it from the Brigade dashboard." |
* | "reply_invalid_title" | "An incident needs a title of 1 to 200 characters, with no invisible characters." |
* | "reply_failed" | "Brigade couldn't do that right now. Try again in a moment." |
* | "reply_unknown" | "Unknown command." |
* | "usage" | "Declare an incident: /inc declare <title> [sev1, sev2, sev3 or sev4]. Acknowledge one: /inc ack [INC-12]." |
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
