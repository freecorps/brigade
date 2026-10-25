export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_ClosedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_ClosedInputs */
/**
* | output |
* | --- |
* | "This page stopped syncing. Reload it to try again." |
*
* @param {Sync_Error_ClosedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_closed: ((inputs?: Sync_Error_ClosedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_ClosedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
