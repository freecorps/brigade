export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_LabelInputs */
/**
* | output |
* | --- |
* | "Workspace" |
*
* @param {Workspace_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_label: ((inputs?: Workspace_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
