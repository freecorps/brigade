export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_Not_InvitedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Error_Not_InvitedInputs */
/**
* | output |
* | --- |
* | "This address has no open invitation. Sign up with the address the invitation was sent to, or ask an owner to send it again if it ran out." |
*
* @param {Auth_Error_Not_InvitedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_not_invited: ((inputs?: Auth_Error_Not_InvitedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Not_InvitedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
