export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_CreateInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_CreateInputs */
/**
* | output |
* | --- |
* | "Create monitor" |
*
* @param {Monitor_CreateInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_create: ((inputs?: Monitor_CreateInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_CreateInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
