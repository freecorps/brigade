export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Member_UpInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Member_UpInputs */
/**
* | output |
* | --- |
* | "Move {name} up" |
*
* @param {Oncall_Member_UpInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_member_up: ((inputs: Oncall_Member_UpInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Member_UpInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
