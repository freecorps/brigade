export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_Handles_UnavailableInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_Handles_UnavailableInputs */
/**
* | output |
* | --- |
* | "The push relay can't open its phone handles, so phones registered through the relay can't be paged." |
*
* @param {Paging_Reason_Relay_Handles_UnavailableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_relay_handles_unavailable: ((inputs?: Paging_Reason_Relay_Handles_UnavailableInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Handles_UnavailableInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
