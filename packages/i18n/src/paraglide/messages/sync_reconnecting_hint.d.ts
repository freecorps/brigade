export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Reconnecting_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Reconnecting_HintInputs */
/**
* | output |
* | --- |
* | "Showing the last list received. Changes you make are sent once the connection is back." |
*
* @param {Sync_Reconnecting_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_reconnecting_hint: ((inputs?: Sync_Reconnecting_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Reconnecting_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
