export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_To_Sign_UpInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_To_Sign_UpInputs */
/**
* | output |
* | --- |
* | "Create an account" |
*
* @param {Auth_To_Sign_UpInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_to_sign_up: ((inputs?: Auth_To_Sign_UpInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_To_Sign_UpInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
