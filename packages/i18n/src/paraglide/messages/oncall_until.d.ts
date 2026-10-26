export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_UntilInputs = {
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown> }} Oncall_UntilInputs */
/**
* | output |
* | --- |
* | "until {time}" |
*
* @param {Oncall_UntilInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_until: ((inputs: Oncall_UntilInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_UntilInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
