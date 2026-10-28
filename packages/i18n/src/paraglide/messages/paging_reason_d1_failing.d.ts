export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Reason_D1_FailingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_Reason_D1_FailingInputs */
/**
* | output |
* | --- |
* | "The database (D1) didn't answer a simple read." |
*
* @param {Paging_Reason_D1_FailingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_reason_d1_failing: ((inputs?: Paging_Reason_D1_FailingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_D1_FailingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
