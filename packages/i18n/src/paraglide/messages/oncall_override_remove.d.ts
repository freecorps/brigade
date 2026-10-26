export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_RemoveInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Override_RemoveInputs */
/**
* | output |
* | --- |
* | "Remove override for {name}" |
*
* @param {Oncall_Override_RemoveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_remove: ((inputs: Oncall_Override_RemoveInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_RemoveInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
