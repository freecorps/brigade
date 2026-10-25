export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_ConflictInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_ConflictInputs */
/**
* | output |
* | --- |
* | "Someone changed it first." |
*
* @param {Sync_Error_ConflictInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_conflict: ((inputs?: Sync_Error_ConflictInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_ConflictInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
