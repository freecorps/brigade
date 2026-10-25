export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_CredentialsInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_CredentialsInputs */
/**
* | output |
* | --- |
* | "That email and password do not match an account." |
*
* @param {Auth_Error_CredentialsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_credentials: ((inputs?: Auth_Error_CredentialsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_CredentialsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
