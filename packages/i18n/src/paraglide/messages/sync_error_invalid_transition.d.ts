export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Error_Invalid_TransitionInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Sync_Error_Invalid_TransitionInputs */
/**
* | output |
* | --- |
* | "Its status changed in the meantime, so that move is no longer allowed." |
*
* @param {Sync_Error_Invalid_TransitionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_error_invalid_transition: ((inputs?: Sync_Error_Invalid_TransitionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Invalid_TransitionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
