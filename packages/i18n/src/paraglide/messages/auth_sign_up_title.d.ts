export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_Up_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_Up_TitleInputs */
/**
* | output |
* | --- |
* | "Create your account" |
*
* @param {Auth_Sign_Up_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_up_title: ((inputs?: Auth_Sign_Up_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
