export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Language_ReadInputs = {
    language: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ language: NonNullable<unknown> }} Workspace_Language_ReadInputs */
/**
* | output |
* | --- |
* | "Brigade writes this workspace's shared text in {language}. An owner can change it." |
*
* @param {Workspace_Language_ReadInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_language_read: ((inputs: Workspace_Language_ReadInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Language_ReadInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
