export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Delete_YesInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Delete_YesInputs */
/**
* | output |
* | --- |
* | "Delete" |
*
* @param {Oncall_Delete_YesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_delete_yes: ((inputs?: Oncall_Delete_YesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Delete_YesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
