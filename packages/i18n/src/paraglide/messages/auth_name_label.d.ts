export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Name_LabelInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Auth_Name_LabelInputs */
/**
* | output |
* | --- |
* | "Your name" |
*
* @param {Auth_Name_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_name_label: ((inputs?: Auth_Name_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Name_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
