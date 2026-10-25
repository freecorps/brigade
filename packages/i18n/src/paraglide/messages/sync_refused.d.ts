export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_RefusedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_RefusedInputs */
/**
* | output |
* | --- |
* | "Not loaded" |
*
* @param {Sync_RefusedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_refused: ((inputs?: Sync_RefusedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_RefusedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
