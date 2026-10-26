export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_GoneInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_GoneInputs */
/**
* | output |
* | --- |
* | "It was deleted." |
*
* @param {Monitor_GoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_gone: ((inputs?: Monitor_GoneInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_GoneInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
