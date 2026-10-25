export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Title_InvalidInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_Title_InvalidInputs */
/**
* | output |
* | --- |
* | "Write a title with visible text." |
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
