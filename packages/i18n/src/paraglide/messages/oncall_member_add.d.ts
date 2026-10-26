export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Member_AddInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Member_AddInputs */
/**
* | output |
* | --- |
* | "Add a person…" |
*
* @param {Oncall_Member_AddInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_member_add: ((inputs?: Oncall_Member_AddInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Member_AddInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
