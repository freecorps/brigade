export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Create_SubmitInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_Create_SubmitInputs */
/**
* | output |
* | --- |
* | "Create workspace" |
*
* @param {Workspace_Create_SubmitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_create_submit: ((inputs?: Workspace_Create_SubmitInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Create_SubmitInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
