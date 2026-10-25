export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Name_InvalidInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_Name_InvalidInputs */
/**
* | output |
* | --- |
* | "A name needs visible text: invisible characters alone don't count." |
*
* @param {Workspace_Name_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_name_invalid: ((inputs?: Workspace_Name_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Name_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
