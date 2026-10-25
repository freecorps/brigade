export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_Too_Many_PendingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_Too_Many_PendingInputs */
/**
* | output |
* | --- |
* | "Wait for the pending changes to be sent, then try again." |
*
* @param {Sync_Error_Too_Many_PendingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_too_many_pending: ((inputs?: Sync_Error_Too_Many_PendingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Too_Many_PendingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
