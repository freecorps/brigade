export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Error_HttpInputs = {
    status: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ status: NonNullable<unknown> }} Stack_Error_HttpInputs */
/**
* | output |
* | --- |
* | "The API answered with HTTP {status}." |
*
* @param {Stack_Error_HttpInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_error_http: ((inputs: Stack_Error_HttpInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_HttpInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
