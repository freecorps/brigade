export type LocalizedString = import('../runtime.js').LocalizedString;
export type Theme_LightInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Theme_LightInputs */
/**
* | output |
* | --- |
* | "Light" |
*
* @param {Theme_LightInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const theme_light: ((inputs?: Theme_LightInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Theme_LightInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
