export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Name_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_Name_LabelInputs */
/**
* | output |
* | --- |
* | "Workspace name" |
*
* @param {Workspace_Name_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_name_label: ((inputs?: Workspace_Name_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Name_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
