export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_Limit_ReachedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_Limit_ReachedInputs */
/**
* | output |
* | --- |
* | "You've reached the limit for this." |
*
* @param {Sync_Error_Limit_ReachedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_limit_reached: ((inputs?: Sync_Error_Limit_ReachedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Limit_ReachedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
