export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Apns_FailingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Apns_FailingInputs */
/**
* | output |
* | --- |
* | "Apple's push service refused the relay's key, or isn't answering, so iPhones can't be paged." |
*
* @param {Paging_Reason_Apns_FailingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_apns_failing: ((inputs?: Paging_Reason_Apns_FailingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Apns_FailingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
