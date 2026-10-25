export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_In_SubmitInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_In_SubmitInputs */
/**
* | output |
* | --- |
* | "Sign in" |
*
* @param {Auth_Sign_In_SubmitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_in_submit: ((inputs?: Auth_Sign_In_SubmitInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_In_SubmitInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
