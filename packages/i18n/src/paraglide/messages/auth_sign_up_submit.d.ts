export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_Up_SubmitInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_Up_SubmitInputs */
/**
* | output |
* | --- |
* | "Create account" |
*
* @param {Auth_Sign_Up_SubmitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_up_submit: ((inputs?: Auth_Sign_Up_SubmitInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_SubmitInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
