export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_Fcm_FailingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_Fcm_FailingInputs */
/**
* | output |
* | --- |
* | "Firebase Cloud Messaging gave the relay no access token." |
*
* @param {Paging_Reason_Fcm_FailingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_fcm_failing: ((inputs?: Paging_Reason_Fcm_FailingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Fcm_FailingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
