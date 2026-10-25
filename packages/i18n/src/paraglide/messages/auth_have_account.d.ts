export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Have_AccountInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Have_AccountInputs */
/**
* | output |
* | --- |
* | "Already have an account?" |
*
* @param {Auth_Have_AccountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_have_account: ((inputs?: Auth_Have_AccountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Have_AccountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
