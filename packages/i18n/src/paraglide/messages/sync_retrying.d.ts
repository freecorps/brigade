export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_RetryingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_RetryingInputs */
/**
* | output |
* | --- |
* | "This page keeps trying on its own." |
*
* @param {Sync_RetryingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_retrying: ((inputs?: Sync_RetryingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_RetryingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
