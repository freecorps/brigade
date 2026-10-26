export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_CancelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_CancelInputs */
/**
* | output |
* | --- |
* | "Cancel" |
*
* @param {Oncall_CancelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_cancel: ((inputs?: Oncall_CancelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_CancelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
