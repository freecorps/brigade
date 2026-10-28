export type LocalizedString = import('../runtime.js').LocalizedString;
export type Slack_Language_WorkspaceInputs = {
    language: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ language: NonNullable<unknown> }} Slack_Language_WorkspaceInputs */
/**
* | output |
* | --- |
* | "Channel messages are written in the workspace's language: {language}." |
*
* @param {Slack_Language_WorkspaceInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const slack_language_workspace: ((inputs: Slack_Language_WorkspaceInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Slack_Language_WorkspaceInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
