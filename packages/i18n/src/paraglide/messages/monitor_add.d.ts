export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_AddInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_AddInputs */
/**
* | output |
* | --- |
* | "Add monitor" |
*
* @param {Monitor_AddInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_add: ((inputs?: Monitor_AddInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_AddInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
