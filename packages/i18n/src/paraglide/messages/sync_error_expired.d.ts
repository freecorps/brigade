export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_ExpiredInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_ExpiredInputs */
/**
* | output |
* | --- |
* | "It waited too long to be sent and was dropped." |
*
* @param {Sync_Error_ExpiredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_expired: ((inputs?: Sync_Error_ExpiredInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_ExpiredInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
