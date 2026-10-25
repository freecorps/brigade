export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Title_InvalidInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_Title_InvalidInputs */
/**
* | output |
* | --- |
* | "Enter a title. Invisible characters alone don't count." |
*
* @param {Declare_Title_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_title_invalid: ((inputs?: Declare_Title_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Title_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
