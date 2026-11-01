export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Relay_Rate_LimitedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Relay_Rate_LimitedInputs */
/**
* | output |
* | --- |
* | "The push relay is limiting this instance's sends, so pages may be late." |
*
* @param {Paging_Reason_Relay_Rate_LimitedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_relay_rate_limited: ((inputs?: Paging_Reason_Relay_Rate_LimitedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Rate_LimitedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
