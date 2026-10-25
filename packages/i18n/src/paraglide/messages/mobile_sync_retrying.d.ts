export type LocalizedString = import('../runtime.js').LocalizedString;
export type Mobile_Sync_RetryingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Mobile_Sync_RetryingInputs */
/**
* | output |
* | --- |
* | "The app keeps trying on its own." |
*
* @param {Mobile_Sync_RetryingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const mobile_sync_retrying: ((inputs?: Mobile_Sync_RetryingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Sync_RetryingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
