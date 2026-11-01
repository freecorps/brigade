export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_Instance_UnregisteredInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_Instance_UnregisteredInputs */
/**
* | output |
* | --- |
* | "This instance isn't registered with the push relay yet, so phones registered through the relay can't be paged." |
*
* @param {Paging_Reason_Relay_Instance_UnregisteredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_relay_instance_unregistered: ((inputs?: Paging_Reason_Relay_Instance_UnregisteredInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Instance_UnregisteredInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
