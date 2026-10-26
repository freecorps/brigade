export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_Not_ConfiguredInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_Not_ConfiguredInputs */
/**
* | output |
* | --- |
* | "No push relay is set up, so every page is recorded as failed." |
*
* @param {Paging_Reason_Relay_Not_ConfiguredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_relay_not_configured: ((inputs?: Paging_Reason_Relay_Not_ConfiguredInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Not_ConfiguredInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
