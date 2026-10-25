export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_Invalid_ArgsInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_Invalid_ArgsInputs */
/**
* | output |
* | --- |
* | "Check what you typed and try again." |
*
* @param {Sync_Error_Invalid_ArgsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_invalid_args: ((inputs?: Sync_Error_Invalid_ArgsInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Invalid_ArgsInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
