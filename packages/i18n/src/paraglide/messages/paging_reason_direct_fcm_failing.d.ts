export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Direct_Fcm_FailingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Direct_Fcm_FailingInputs */
/**
* | output |
* | --- |
* | "Google refused this instance's own Firebase service account, or isn't answering. Android phones are paged through the push relay meanwhile." |
*
* @param {Paging_Reason_Direct_Fcm_FailingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_direct_fcm_failing: ((inputs?: Paging_Reason_Direct_Fcm_FailingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Direct_Fcm_FailingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
