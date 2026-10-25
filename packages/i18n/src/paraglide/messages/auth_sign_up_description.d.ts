export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Sign_Up_DescriptionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Sign_Up_DescriptionInputs */
/**
* | output |
* | --- |
* | "You will own a new workspace. Invite your team once it is set up." |
*
* @param {Auth_Sign_Up_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_sign_up_description: ((inputs?: Auth_Sign_Up_DescriptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_DescriptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
