export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_UnreachableInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_UnreachableInputs */
/**
* | output |
* | --- |
* | "The push relay isn't answering." |
*
* @param {Paging_Reason_Relay_UnreachableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_relay_unreachable: ((inputs?: Paging_Reason_Relay_UnreachableInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_UnreachableInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
