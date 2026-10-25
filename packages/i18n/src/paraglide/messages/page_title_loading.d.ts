export type LocalizedString = import('../runtime.js').LocalizedString;
export type Page_Title_LoadingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Page_Title_LoadingInputs */
/**
* | output |
* | --- |
* | "Loading" |
*
* @param {Page_Title_LoadingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const page_title_loading: ((inputs?: Page_Title_LoadingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_Title_LoadingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
