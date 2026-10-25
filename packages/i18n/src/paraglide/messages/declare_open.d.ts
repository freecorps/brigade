export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_OpenInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_OpenInputs */
/**
* | output |
* | --- |
* | "Declare incident" |
*
* @param {Declare_OpenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_open: ((inputs?: Declare_OpenInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_OpenInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
