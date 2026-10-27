export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_SettingsInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Call_SettingsInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Calls" |
* | "description" | "On an iPhone with the Brigade app, an urgent page can also ring like a phone call, right after its notification. Choose which pages ring. The notification al..." |
* | "legend" | "Which pages ring as a call" |
* | "sev1_sev2" | "SEV1 pages and SEV2 escalations" |
* | "sev1_sev2_hint" | "Default. A SEV2 rings only when a level escalates because nobody acknowledged." |
* | "sev1" | "SEV1 pages only" |
* | "sev1_hint" | "SEV2 escalations come as notifications." |
* | "never" | "Never" |
* | "never_hint" | "Every page comes as a notification only." |
* | "saving" | "Saving…" |
* | "saved" | "Saved" |
* | "failed" | "Couldn't save your choice. Try again." |
* | "loading" | "Loading your choice…" |
* | "load_failed" | "Couldn't load your choice." |
* | "sheet_title" | "Which pages ring as a call?" |
* | * | "Calls" |
*
* @param {Call_SettingsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_settings: ((inputs: Call_SettingsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_SettingsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
