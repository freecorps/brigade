export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_LanguageInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Workspace_LanguageInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Workspace language" |
* | "description" | "The language Brigade writes shared text in: the titles of incidents monitors and alert sources open, Slack channel messages and AI postmortem drafts. Emails ..." |
* | "label" | "Language" |
* | "hint" | "Only owners can change it. Text already written stays as it is." |
* | "saving" | "Saving…" |
* | "saved" | "Saved" |
* | "failed" | "Couldn't save the language. Try again." |
* | "loading" | "Loading the language…" |
* | "load_failed" | "Couldn't load the workspace language." |
* | * | "Workspace language" |
*
* @param {Workspace_LanguageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_language: ((inputs: Workspace_LanguageInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_LanguageInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
