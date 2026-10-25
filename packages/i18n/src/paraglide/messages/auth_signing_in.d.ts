export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Signing_InInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Signing_InInputs */
/**
* | output |
* | --- |
* | "Signing in…" |
*
* @param {Auth_Signing_InInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_signing_in: ((inputs?: Auth_Signing_InInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Signing_InInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
