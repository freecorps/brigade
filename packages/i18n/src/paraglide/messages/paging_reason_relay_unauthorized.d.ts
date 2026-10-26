export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_UnauthorizedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_UnauthorizedInputs */
/**
* | output |
* | --- |
* | "The push relay refused Brigade's send token, so no page can go out." |
*
* @param {Paging_Reason_Relay_UnauthorizedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_relay_unauthorized: ((inputs?: Paging_Reason_Relay_UnauthorizedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_UnauthorizedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
