export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_ReconnectingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_ReconnectingInputs */
/**
* | output |
* | --- |
* | "Reconnecting…" |
*
* @param {Sync_ReconnectingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_reconnecting: ((inputs?: Sync_ReconnectingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_ReconnectingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
