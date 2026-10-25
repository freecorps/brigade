export type LocalizedString = import('../runtime.js').LocalizedString;
export type Sync_Refused_HintInputs = {
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown> }} Sync_Refused_HintInputs */
/**
* | output |
* | --- |
* | "Brigade couldn't load this list. {reason}" |
*
* @param {Sync_Refused_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const sync_refused_hint: ((inputs: Sync_Refused_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Refused_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
