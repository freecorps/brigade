export type LocalizedString = import('../runtime.js').LocalizedString;
export type Mobile_Sync_Offline_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Mobile_Sync_Offline_HintInputs */
/**
* | output |
* | --- |
* | "Can't reach Brigade right now. Changes you make are sent when the connection is back, even if the app is closed meanwhile." |
*
* @param {Mobile_Sync_Offline_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const mobile_sync_offline_hint: ((inputs?: Mobile_Sync_Offline_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Sync_Offline_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
