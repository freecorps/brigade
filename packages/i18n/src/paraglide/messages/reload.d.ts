export type LocalizedString = import('../runtime.js').LocalizedString;
export type ReloadInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} ReloadInputs */
/**
* | output |
* | --- |
* | "Reload" |
*
* @param {ReloadInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const reload: ((inputs?: ReloadInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<ReloadInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
