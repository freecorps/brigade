export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Password_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Password_HintInputs */
/**
* | output |
* | --- |
* | "At least 8 characters." |
*
* @param {Auth_Password_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_password_hint: ((inputs?: Auth_Password_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Password_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
