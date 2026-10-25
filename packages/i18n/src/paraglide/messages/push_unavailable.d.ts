export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_UnavailableInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_UnavailableInputs */
/**
* | output |
* | --- |
* | "Not available on this platform yet." |
*
* @param {Push_UnavailableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_unavailable: ((inputs?: Push_UnavailableInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_UnavailableInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
