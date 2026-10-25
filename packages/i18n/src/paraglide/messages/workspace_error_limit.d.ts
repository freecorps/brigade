export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_Error_LimitInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_Error_LimitInputs */
/**
* | output |
* | --- |
* | "You belong to as many workspaces as Brigade allows. Ask an owner to add you instead." |
*
* @param {Workspace_Error_LimitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_error_limit: ((inputs?: Workspace_Error_LimitInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Error_LimitInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
