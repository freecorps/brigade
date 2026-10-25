export type LocalizedString = import('../runtime.js').LocalizedString;
export type Auth_Error_Too_LongInputs = {
    max: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ max: NonNullable<unknown> }} Auth_Error_Too_LongInputs */
/**
* | output |
* | --- |
* | "Use at most {max} characters." |
*
* @param {Auth_Error_Too_LongInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const auth_error_too_long: ((inputs: Auth_Error_Too_LongInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Too_LongInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
