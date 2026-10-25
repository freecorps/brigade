export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_Public_KeyInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Push_Public_KeyInputs */
/**
* | output |
* | --- |
* | "Device public key" |
*
* @param {Push_Public_KeyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_public_key: ((inputs?: Push_Public_KeyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Public_KeyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
