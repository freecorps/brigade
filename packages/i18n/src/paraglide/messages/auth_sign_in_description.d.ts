export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_In_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_In_DescriptionInputs */
/**
* | output |
* | --- |
* | "Use the email and password you signed up with." |
*
* @param {Auth_Sign_In_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_in_description: ((inputs?: Auth_Sign_In_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_In_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
