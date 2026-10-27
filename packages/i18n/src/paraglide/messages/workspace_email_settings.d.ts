export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Email_SettingsInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Workspace_Email_SettingsInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Email when paging fails" |
* | "description" | "Who Brigade emails when a page doesn't get through. Both are on by default." |
* | "unpaged" | "Tell members a page missed them" |
* | "unpaged_hint" | "Email a member when a SEV1 or SEV2 page didn't reach their phone, once per incident. Each member can also turn this off for themselves." |
* | "nobody" | "Tell owners when a page reached nobody" |
* | "nobody_hint" | "Email the owners when a page reached nobody and nothing else will page. It's the fallback when paging fails, so members can't turn it off for themselves." |
* | "nobody_off" | "While this is off, nobody hears of a page that reached nobody until they open Brigade." |
* | "saving" | "Saving…" |
* | "saved" | "Saved" |
* | "failed" | "Couldn't save the setting. Try again." |
* | "loading" | "Loading the settings…" |
* | "load_failed" | "Couldn't load the settings." |
* | * | "Email when paging fails" |
*
* @param {Workspace_Email_SettingsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_email_settings: ((inputs: Workspace_Email_SettingsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Email_SettingsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
