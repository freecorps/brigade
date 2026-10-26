export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Member_DownInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Member_DownInputs */
/**
* | output |
* | --- |
* | "Move {name} down" |
*
* @param {Oncall_Member_DownInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_member_down: ((inputs: Oncall_Member_DownInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Member_DownInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
