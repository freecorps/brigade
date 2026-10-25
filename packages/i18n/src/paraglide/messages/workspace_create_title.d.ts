export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Create_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_Create_TitleInputs */
/**
* | output |
* | --- |
* | "Create your workspace" |
*
* @param {Workspace_Create_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_create_title: ((inputs?: Workspace_Create_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Create_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
