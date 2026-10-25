export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_ForbiddenInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_ForbiddenInputs */
/**
* | output |
* | --- |
* | "You don't have permission to do that." |
*
* @param {Sync_Error_ForbiddenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_forbidden: ((inputs?: Sync_Error_ForbiddenInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_ForbiddenInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
