export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_Member_LimitInputs = {
    max: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ max: NonNullable<unknown> }} Oncall_Override_Member_LimitInputs */
/**
* | output |
* | --- |
* | "This person already has {max} upcoming overrides on this schedule, the most one person can have. Remove one first." |
*
* @param {Oncall_Override_Member_LimitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_member_limit: ((inputs: Oncall_Override_Member_LimitInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_Member_LimitInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
