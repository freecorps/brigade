export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_RequiredInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_RequiredInputs */
/**
* | output |
* | --- |
* | "Fill in this field." |
*
* @param {Auth_Error_RequiredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_required: ((inputs?: Auth_Error_RequiredInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_RequiredInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
