export type LocalizedString = import('../runtime.js').LocalizedString;
export type Workspace_CreatingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Workspace_CreatingInputs */
/**
* | output |
* | --- |
* | "Creating workspace…" |
*
* @param {Workspace_CreatingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const workspace_creating: ((inputs?: Workspace_CreatingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_CreatingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
