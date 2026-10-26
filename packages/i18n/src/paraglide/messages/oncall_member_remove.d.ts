export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Member_RemoveInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Member_RemoveInputs */
/**
* | output |
* | --- |
* | "Remove {name} from the layer" |
*
* @param {Oncall_Member_RemoveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_member_remove: ((inputs: Oncall_Member_RemoveInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Member_RemoveInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
