export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Name_PlaceholderInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_Name_PlaceholderInputs */
/**
* | output |
* | --- |
* | "Platform team" |
*
* @param {Workspace_Name_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_name_placeholder: ((inputs?: Workspace_Name_PlaceholderInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Name_PlaceholderInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
