export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_Sign_Up_ClosedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_Sign_Up_ClosedInputs */
/**
* | output |
* | --- |
* | "Sign-up is closed on this instance — ask an owner for an invitation." |
*
* @param {Auth_Error_Sign_Up_ClosedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_sign_up_closed: ((inputs?: Auth_Error_Sign_Up_ClosedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Sign_Up_ClosedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
