export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_Up_Invite_OnlyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_Up_Invite_OnlyInputs */
/**
* | output |
* | --- |
* | "Only an address with a pending invitation can create an account here." |
*
* @param {Auth_Sign_Up_Invite_OnlyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_up_invite_only: ((inputs?: Auth_Sign_Up_Invite_OnlyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_Invite_OnlyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
