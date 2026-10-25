export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Signing_UpInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Signing_UpInputs */
/**
* | output |
* | --- |
* | "Creating account…" |
*
* @param {Auth_Signing_UpInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_signing_up: ((inputs?: Auth_Signing_UpInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Signing_UpInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
