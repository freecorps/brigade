export type LocalizedString = import('../runtime.js').LocalizedString;
export type Page_Title_Create_WorkspaceInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Page_Title_Create_WorkspaceInputs */
/**
* | output |
* | --- |
* | "Create your workspace" |
*
* @param {Page_Title_Create_WorkspaceInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const page_title_create_workspace: ((inputs?: Page_Title_Create_WorkspaceInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_Title_Create_WorkspaceInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
