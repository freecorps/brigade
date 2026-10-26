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
* | "description" | "Declare and acknowledge incidents from Slack with /inc, and keep one message per incident in a channel." |
* | "add" | "Add to Slack" |
* | "adding" | "Opening Slack…" |
* | "connected" | "Connected to {team}" |
* | "not_connected" | "Not connected to a Slack workspace." |
* | "channel_label" | "Channel ID" |
* | "channel_hint" | "In Slack, open the channel's details and copy the ID at the bottom. It starts with C, or G for a private channel, where Brigade must be invited." |
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
* | "disconnect_confirm" | "Disconnect {team}? /inc stops working there and incidents are no longer posted. To revoke Brigade's access, also remove the app in Slack's settings." |
* | "disconnect_cancel" | "Keep connected" |
* | "disconnect_failed" | "Couldn't disconnect. Try again." |
* | "manage_only" | "Only owners and admins can connect Slack or change where incidents are posted." |
* | "result_connected" | "Slack is connected. Pick a channel for incidents." |
* | "result_cancelled" | "Connecting Slack was cancelled." |
* | "result_team_taken" | "That Slack workspace is already connected to another Brigade workspace." |
* | "result_not_configured" | "Slack isn't set up on this Brigade server." |
* | "result_failed" | "Couldn't connect Slack. Try again." |
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
