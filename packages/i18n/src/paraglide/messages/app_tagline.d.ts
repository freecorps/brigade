export type LocalizedString = import('../runtime.js').LocalizedString;
export type App_TaglineInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} App_TaglineInputs */
/**
* | output |
* | --- |
* | "Open-source incident management that deploys to your Cloudflare account." |
*
* @param {App_TaglineInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const app_tagline: ((inputs?: App_TaglineInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<App_TaglineInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
