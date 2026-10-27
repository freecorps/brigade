export type LocalizedString = import('../runtime.js').LocalizedString;
export type Slack_CardInputs = {
    part: NonNullable<unknown>;
    team: NonNullable<unknown>;
    channel: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, team: NonNullable<unknown>, channel: NonNullable<unknown> }} Slack_CardInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Slack" |
* | "description" | "Run incidents from Slack with /inc, post each one in a channel and mirror its timeline there." |
* | "add" | "Add to Slack" |
* | "adding" | "Opening Slack…" |
* | "connected" | "Connected to {team}" |
* | "load_failed" | "Couldn't load the Slack connection, so Brigade can't tell whether it's connected." |
* | "retry" | "Try again" |
* | "not_connected" | "Not connected to a Slack workspace." |
* | "channel_label" | "Channel" |
* | "channel_hint" | "Each incident gets a message here. Private channels show up once Brigade is invited to them." |
* | "channel_invalid" | "A channel ID starts with C or G, followed by capital letters and numbers." |
* | "channel_none" | "No channel yet, so incidents aren't posted to Slack." |
* | "channel_current" | "Incidents are posted in {channel}." |
* | "language_label" | "Language of channel messages" |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "saved" | "Saved." |
* | "save_failed" | "Couldn't save. Try again." |
* | "disconnect" | "Disconnect" |
* | "disconnecting" | "Disconnecting…" |
* | "disconnect_confirm" | "Disconnect {team}? /inc stops working there, incidents are no longer posted, and Brigade gives its access back to Slack." |
* | "disconnect_cancel" | "Keep connected" |
* | "disconnect_failed" | "Couldn't disconnect. Try again." |
* | "manage_only" | "Only owners and admins can connect Slack or change where incidents are posted." |
* | "result_connected" | "Slack is connected. Pick a channel for incidents." |
* | "result_cancelled" | "Connecting Slack was cancelled." |
* | "result_team_taken" | "That Slack workspace is already connected to another Brigade workspace." |
* | "result_not_configured" | "Slack isn't set up on this Brigade server." |
* | "result_failed" | "Couldn't connect Slack. Try again." |
* | "channel_pick" | "Pick a channel" |
* | "channel_none_option" | "No channel" |
* | "channel_loading" | "Loading channels from Slack…" |
* | "channel_list_failed" | "Couldn't load the channels from Slack. Enter the channel's ID instead." |
* | "channel_reload" | "Reload channels" |
* | "channel_id_label" | "Channel ID" |
* | "channel_id_hint" | "In Slack, open the channel's details and copy the ID at the bottom. It starts with C, or G for a private channel, where Brigade must be invited." |
* | "channel_private" | "{channel} (private)" |
* | "channel_unlisted" | "{channel} (not in the list)" |
* | "incident_channels_label" | "A channel per incident" |
* | "incident_channels_hint" | "Brigade creates a channel such as #inc-12-checkout-down, invites the incident's roles and whoever is paged, and posts the timeline there." |
* | "incident_channels_off" | "Off" |
* | "incident_channels_all" | "For every incident" |
* | "incident_channels_major" | "For SEV1 and SEV2 only" |
* | "private_label" | "Make incident channels private" |
* | "archive_label" | "When the incident is resolved" |
* | "archive_keep" | "Keep its channel" |
* | "archive_0" | "Archive its channel right away" |
* | "archive_1" | "Archive its channel after an hour" |
* | "archive_24" | "Archive its channel after a day" |
* | "archive_168" | "Archive its channel after a week" |
* | "revoked_uninstalled" | "Brigade was removed from {team} in Slack, so nothing is posted there. Connect Slack again to resume." |
* | "revoked_tokens_revoked" | "Slack revoked Brigade's access to {team}, so nothing is posted there. Connect Slack again to resume." |
* | "reconnect" | "Connect again" |
* | * | "Slack" |
*
* @param {Slack_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const slack_card: ((inputs: Slack_CardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Slack_CardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
