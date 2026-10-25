export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Title_EmptyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_Title_EmptyInputs */
/**
* | output |
* | --- |
* | "Enter a title." |
*
* @param {Declare_Title_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_title_empty: ((inputs?: Declare_Title_EmptyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Title_EmptyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
