export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Password_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Password_LabelInputs */
/**
* | output |
* | --- |
* | "Password" |
*
* @param {Auth_Password_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_password_label: ((inputs?: Auth_Password_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Password_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
