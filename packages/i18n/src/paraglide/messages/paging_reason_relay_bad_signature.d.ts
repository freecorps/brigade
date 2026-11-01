export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_Bad_SignatureInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_Bad_SignatureInputs */
/**
* | output |
* | --- |
* | "The push relay refused this instance's signature: its key (RELAY_INSTANCE_KEY or RELAY_INSTANCE_ID) is wrong, or this server's clock is more than 5 minutes o..." |
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
