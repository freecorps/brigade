export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Checked_AtInputs = {
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown> }} Stack_Checked_AtInputs */
/**
* | output |
* | --- |
* | "Checked at {time}" |
*
* @param {Stack_Checked_AtInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_checked_at: ((inputs: Stack_Checked_AtInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Checked_AtInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
