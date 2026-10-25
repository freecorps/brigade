export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Name_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_Name_HintInputs */
/**
* | output |
* | --- |
* | "For example, Platform team." |
*
* @param {Workspace_Name_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_name_hint: ((inputs?: Workspace_Name_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Name_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
