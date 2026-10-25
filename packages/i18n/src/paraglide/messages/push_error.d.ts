export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_ErrorInputs = {
    error: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ error: NonNullable<unknown> }} Push_ErrorInputs */
/**
* | output |
* | --- |
* | "Failed: {error}" |
*
* @param {Push_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_error: ((inputs: Push_ErrorInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_ErrorInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
