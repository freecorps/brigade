export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_Instance_RevokedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_Instance_RevokedInputs */
/**
* | output |
* | --- |
* | "The push relay revoked this instance, so phones registered through the relay can't be paged." |
*
* @param {Paging_Reason_Relay_Instance_RevokedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_relay_instance_revoked: ((inputs?: Paging_Reason_Relay_Instance_RevokedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Instance_RevokedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
