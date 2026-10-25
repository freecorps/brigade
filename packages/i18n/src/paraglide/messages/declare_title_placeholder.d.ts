export type LocalizedString = import('../runtime.js').LocalizedString;
export type Declare_Title_PlaceholderInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Declare_Title_PlaceholderInputs */
/**
* | output |
* | --- |
* | "What's happening?" |
*
* @param {Declare_Title_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const declare_title_placeholder: ((inputs?: Declare_Title_PlaceholderInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Title_PlaceholderInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
