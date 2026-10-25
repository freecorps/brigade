export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_EmailInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_EmailInputs */
/**
* | output |
* | --- |
* | "Enter an email address like name@example.com." |
*
* @param {Auth_Error_EmailInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_email: ((inputs?: Auth_Error_EmailInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_EmailInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
