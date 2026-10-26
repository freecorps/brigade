export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Override_TitleInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Oncall_Override_TitleInputs */
/**
* | output |
* | --- |
* | "Override on {name}" |
*
* @param {Oncall_Override_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_override_title: ((inputs: Oncall_Override_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
