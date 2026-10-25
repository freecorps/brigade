export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Name_InvalidInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Name_InvalidInputs */
/**
* | output |
* | --- |
* | "Remove invisible, control or bidi characters from the name." |
*
* @param {Auth_Name_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_name_invalid: ((inputs?: Auth_Name_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Name_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
