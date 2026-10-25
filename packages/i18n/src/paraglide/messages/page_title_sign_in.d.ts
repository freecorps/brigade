export type LocalizedString = import('../runtime.js').LocalizedString;
export type Page_Title_Sign_InInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Page_Title_Sign_InInputs */
/**
* | output |
* | --- |
* | "Sign in" |
*
* @param {Page_Title_Sign_InInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const page_title_sign_in: ((inputs?: Page_Title_Sign_InInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_Title_Sign_InInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
