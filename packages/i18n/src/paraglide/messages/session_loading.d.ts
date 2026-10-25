export type LocalizedString = import('../runtime.js').LocalizedString;
export type Session_LoadingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Session_LoadingInputs */
/**
* | output |
* | --- |
* | "Loading your workspace…" |
*
* @param {Session_LoadingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const session_loading: ((inputs?: Session_LoadingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Session_LoadingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
