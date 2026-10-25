export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sign_OutInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sign_OutInputs */
/**
* | output |
* | --- |
* | "Sign out" |
*
* @param {Sign_OutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sign_out: ((inputs?: Sign_OutInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sign_OutInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
