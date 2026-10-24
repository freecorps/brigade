export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Error_TimeoutInputs = {
    seconds: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ seconds: NonNullable<unknown> }} Stack_Error_TimeoutInputs */
/**
* | output |
* | --- |
* | "The request took longer than {seconds} seconds and was cancelled." |
*
* @param {Stack_Error_TimeoutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_error_timeout: ((inputs: Stack_Error_TimeoutInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_TimeoutInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
