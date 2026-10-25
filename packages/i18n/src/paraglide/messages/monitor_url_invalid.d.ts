export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Url_InvalidInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Monitor_Url_InvalidInputs */
/**
* | output |
* | --- |
* | "Use a public http or https address." |
*
* @param {Monitor_Url_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_url_invalid: ((inputs?: Monitor_Url_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Url_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
