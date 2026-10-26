export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_UnnamedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_UnnamedInputs */
/**
* | output |
* | --- |
* | "Unnamed member" |
*
* @param {Oncall_UnnamedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_unnamed: ((inputs?: Oncall_UnnamedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_UnnamedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
