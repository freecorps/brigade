export type LocalizedString = import('../runtime.js').LocalizedString;
export type Member_Email_SettingsInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Member_Email_SettingsInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Email" |
* | "description" | "What Brigade emails you about in this workspace." |
* | "missed" | "Missed pages" |
* | "missed_hint" | "When a SEV1 or SEV2 page doesn't reach your phone, Brigade emails you, once per incident." |
* | "missed_workspace_off" | "Your workspace has turned these emails off for everyone." |
* | "reminders" | "Follow-up reminders" |
* | "reminders_hint" | "Each morning at 9:00 in your time zone, a list of your open follow-ups due that day or overdue. At most one email a day." |
* | "owners_note" | "Owners always get the email when a page reached nobody, whatever they choose here: it's the fallback when paging fails." |
* | "saving" | "Saving…" |
* | "saved" | "Saved" |
* | "failed" | "Couldn't save your choice. Try again." |
* | "loading" | "Loading your choices…" |
* | "load_failed" | "Couldn't load your choices." |
* | "on" | "On" |
* | "off" | "Off" |
* | * | "Email" |
*
* @param {Member_Email_SettingsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const member_email_settings: ((inputs: Member_Email_SettingsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Member_Email_SettingsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
