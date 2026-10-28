export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_Up_Closed_TitleInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_Up_Closed_TitleInputs */
/**
* | output |
* | --- |
* | "Sign-up is closed" |
*
* @param {Auth_Sign_Up_Closed_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_up_closed_title: ((inputs?: Auth_Sign_Up_Closed_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_Closed_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
