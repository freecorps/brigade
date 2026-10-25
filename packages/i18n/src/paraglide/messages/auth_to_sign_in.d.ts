export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_To_Sign_InInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_To_Sign_InInputs */
/**
* | output |
* | --- |
* | "Sign in" |
*
* @param {Auth_To_Sign_InInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_to_sign_in: ((inputs?: Auth_To_Sign_InInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_To_Sign_InInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
