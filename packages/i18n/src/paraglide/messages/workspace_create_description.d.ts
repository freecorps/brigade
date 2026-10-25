export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Create_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_Create_DescriptionInputs */
/**
* | output |
* | --- |
* | "Incidents and the people who handle them live in a workspace." |
*
* @param {Workspace_Create_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_create_description: ((inputs?: Workspace_Create_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Create_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
