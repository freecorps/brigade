export type LocalizedString = import('../runtime.js').LocalizedString;
export type App_NameInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} App_NameInputs */
/**
* | output |
* | --- |
* | "Brigade" |
*
* @param {App_NameInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const app_name: ((inputs?: App_NameInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<App_NameInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
