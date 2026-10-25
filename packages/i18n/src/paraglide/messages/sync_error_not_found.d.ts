export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_Not_FoundInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_Not_FoundInputs */
/**
* | output |
* | --- |
* | "The incident no longer exists." |
*
* @param {Sync_Error_Not_FoundInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_not_found: ((inputs?: Sync_Error_Not_FoundInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Not_FoundInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
