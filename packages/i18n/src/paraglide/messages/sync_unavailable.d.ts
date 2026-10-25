export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_UnavailableInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_UnavailableInputs */
/**
* | output |
* | --- |
* | "Sync unavailable" |
*
* @param {Sync_UnavailableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_unavailable: ((inputs?: Sync_UnavailableInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_UnavailableInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
