export type LocalizedString = import('../runtime.js').LocalizedString;
export type Page_Title_Sign_UpInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Page_Title_Sign_UpInputs */
/**
* | output |
* | --- |
* | "Create your account" |
*
* @param {Page_Title_Sign_UpInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const page_title_sign_up: ((inputs?: Page_Title_Sign_UpInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_Title_Sign_UpInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
