export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_ConnectingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_ConnectingInputs */
/**
* | output |
* | --- |
* | "Connecting…" |
*
* @param {Sync_ConnectingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_connecting: ((inputs?: Sync_ConnectingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_ConnectingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
