export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_InternalInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_InternalInputs */
/**
* | output |
* | --- |
* | "Something went wrong on the server. Try again." |
*
* @param {Sync_Error_InternalInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_internal: ((inputs?: Sync_Error_InternalInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_InternalInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
