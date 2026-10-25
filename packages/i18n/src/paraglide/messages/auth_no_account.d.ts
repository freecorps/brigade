export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_No_AccountInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_No_AccountInputs */
/**
* | output |
* | --- |
* | "New to Brigade?" |
*
* @param {Auth_No_AccountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_no_account: ((inputs?: Auth_No_AccountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_No_AccountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
