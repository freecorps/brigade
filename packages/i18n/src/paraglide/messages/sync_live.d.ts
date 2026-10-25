export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_LiveInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_LiveInputs */
/**
* | output |
* | --- |
* | "Live" |
*
* @param {Sync_LiveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_live: ((inputs?: Sync_LiveInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_LiveInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
