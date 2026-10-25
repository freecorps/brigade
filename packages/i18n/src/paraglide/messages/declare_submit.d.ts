export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_SubmitInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_SubmitInputs */
/**
* | output |
* | --- |
* | "Declare" |
*
* @param {Declare_SubmitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_submit: ((inputs?: Declare_SubmitInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_SubmitInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
