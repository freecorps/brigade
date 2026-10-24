export type LocalizedString = import('../runtime.js').LocalizedString;
export type Theme_DarkInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Theme_DarkInputs */
/**
* | output |
* | --- |
* | "Dark" |
*
* @param {Theme_DarkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const theme_dark: ((inputs?: Theme_DarkInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Theme_DarkInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
