export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_CreateInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_CreateInputs */
/**
* | output |
* | --- |
* | "Create schedule" |
*
* @param {Oncall_CreateInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_create: ((inputs?: Oncall_CreateInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_CreateInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
