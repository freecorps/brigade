export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Unavailable_HintInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Unavailable_HintInputs */
/**
* | output |
* | --- |
* | "Couldn't connect to Brigade Sync. For now it only runs in the local stack, started from the repository root:" |
*
* @param {Sync_Unavailable_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_unavailable_hint: ((inputs?: Sync_Unavailable_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Unavailable_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
