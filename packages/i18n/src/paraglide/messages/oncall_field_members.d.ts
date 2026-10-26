export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Field_MembersInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Field_MembersInputs */
/**
* | output |
* | --- |
* | "People, in rotation order" |
*
* @param {Oncall_Field_MembersInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_field_members: ((inputs?: Oncall_Field_MembersInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_MembersInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
