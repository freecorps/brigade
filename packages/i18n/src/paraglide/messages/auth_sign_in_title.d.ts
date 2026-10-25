export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_In_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_In_TitleInputs */
/**
* | output |
* | --- |
* | "Sign in to Brigade" |
*
* @param {Auth_Sign_In_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_in_title: ((inputs?: Auth_Sign_In_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_In_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
