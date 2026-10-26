export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_DeleteInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_DeleteInputs */
/**
* | output |
* | --- |
* | "Delete schedule" |
*
* @param {Oncall_DeleteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_delete: ((inputs?: Oncall_DeleteInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_DeleteInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
