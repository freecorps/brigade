export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_GenericInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_GenericInputs */
/**
* | output |
* | --- |
* | "Something went wrong. Try again." |
*
* @param {Auth_Error_GenericInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_generic: ((inputs?: Auth_Error_GenericInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_GenericInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
