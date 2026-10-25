export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_CancelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_CancelInputs */
/**
* | output |
* | --- |
* | "Cancel" |
*
* @param {Declare_CancelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_cancel: ((inputs?: Declare_CancelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_CancelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
