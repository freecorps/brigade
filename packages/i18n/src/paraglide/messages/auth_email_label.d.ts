export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Email_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Email_LabelInputs */
/**
* | output |
* | --- |
* | "Email" |
*
* @param {Auth_Email_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_email_label: ((inputs?: Auth_Email_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Email_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
