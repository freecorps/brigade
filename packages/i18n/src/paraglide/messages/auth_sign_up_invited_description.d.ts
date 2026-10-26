export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_Up_Invited_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_Up_Invited_DescriptionInputs */
/**
* | output |
* | --- |
* | "Use the email address the invitation was sent to. You'll join the workspace once you confirm it." |
*
* @param {Auth_Sign_Up_Invited_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_up_invited_description: ((inputs?: Auth_Sign_Up_Invited_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_Invited_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
