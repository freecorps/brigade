export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_SaveInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_SaveInputs */
/**
* | output |
* | --- |
* | "Save changes" |
*
* @param {Oncall_SaveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_save: ((inputs?: Oncall_SaveInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_SaveInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
