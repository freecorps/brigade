export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Offline_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Offline_HintInputs */
/**
* | output |
* | --- |
* | "Can't reach Brigade right now. Changes you make are sent when the connection is back, as long as this page stays open." |
*
* @param {Sync_Offline_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_offline_hint: ((inputs?: Sync_Offline_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Offline_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
