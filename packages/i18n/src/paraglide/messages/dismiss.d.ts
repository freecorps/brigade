export type LocalizedString = import('../runtime.js').LocalizedString;
export type DismissInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} DismissInputs */
/**
* | output |
* | --- |
* | "Dismiss" |
*
* @param {DismissInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const dismiss: ((inputs?: DismissInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<DismissInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
