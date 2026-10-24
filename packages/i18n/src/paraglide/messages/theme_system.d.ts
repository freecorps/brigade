export type LocalizedString = import('../runtime.js').LocalizedString;
export type Theme_SystemInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Theme_SystemInputs */
/**
* | output |
* | --- |
* | "System" |
*
* @param {Theme_SystemInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const theme_system: ((inputs?: Theme_SystemInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Theme_SystemInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
