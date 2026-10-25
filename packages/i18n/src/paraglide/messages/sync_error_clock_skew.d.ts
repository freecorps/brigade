export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_Clock_SkewInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_Clock_SkewInputs */
/**
* | output |
* | --- |
* | "Your device clock is ahead of the server. Fix the date and time and try again." |
*
* @param {Sync_Error_Clock_SkewInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_clock_skew: ((inputs?: Sync_Error_Clock_SkewInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Clock_SkewInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
