export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_Bad_SignatureInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_Bad_SignatureInputs */
/**
* | output |
* | --- |
* | "The push relay refused this instance's key (RELAY_INSTANCE_KEY), so phones registered through the relay can't be paged." |
*
* @param {Paging_Reason_Relay_Bad_SignatureInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_relay_bad_signature: ((inputs?: Paging_Reason_Relay_Bad_SignatureInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Bad_SignatureInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
